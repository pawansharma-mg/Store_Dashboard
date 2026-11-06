/* Helpers shared by every page (loaded with defer, after the page's own script). Nothing here changes a figure; it only draws.
   - bars behind the value column of the summary tables
   - an icon on every tile, and numbers that count up (or move from the old to the new number when a filter changes)
   - bar charts above the month / day / ageing tables (a click on a bar does what the table row does; there are no round charts)
   - a CSV button in the heading of every table card (a list that shows only its first rows is opened to all rows first, then put back)
   - a shadow under the header once scrolled, a back-to-top button, and "/" to jump to the search box */
(function () {
  'use strict';

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- header, back to top, "/" for search
  var stick = document.querySelector('.stick');
  var up = document.createElement('button');
  up.type = 'button';
  up.className = 'totop';
  up.hidden = true;
  up.setAttribute('aria-label', 'Back to top');
  up.title = 'Back to top';
  up.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  document.body.appendChild(up);
  function onScroll() {
    var y = window.scrollY || document.documentElement.scrollTop;
    if (stick) stick.classList.toggle('scrolled', y > 4);
    up.hidden = y < 700;
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  var on = document.querySelector('.nav a.on');
  if (on) on.setAttribute('aria-current', 'page');
  // ---------------------------------------------------------------- page title, header, density, connection warning
  var embedded = /[?&]embed=1/.test(location.search) || window.self !== window.top; // inside the Summary the pages have no header of their own
  (function shell() {
    var density = 'comfortable';
    try { density = localStorage.getItem('spr-density') === 'compact' ? 'compact' : 'comfortable'; } catch (e) {}
    document.documentElement.dataset.density = density;
    if (embedded) return;
    var nav = document.querySelector('.nav'), navOn = document.querySelector('.nav a.on'), title = navOn ? navOn.textContent.trim() : (document.title || '');
    // the name of the page beside the brand (shown once the page is scrolled) and as the title of the page
    var h1 = document.querySelector('.top h1');
    if (h1 && title) { var s = document.createElement('span'); s.className = 'pgname'; s.textContent = title; h1.appendChild(s); }
    var wrap = document.querySelector('.wrap'), sub = document.querySelector('.top .sub');
    if (wrap && sub && title) {
      var head = document.createElement('div');
      head.className = 'pagehead';
      var h2 = document.createElement('h2'), p = document.createElement('p');
      h2.textContent = title;
      head.appendChild(h2); head.appendChild(p);
      var sync = function () { // the description follows the header text, which some pages change when the data arrives
        var t = sub.textContent.replace(/\s+/g, ' ').trim(), i = t.indexOf(' \u00b7 ');
        t = i > 0 && i < 40 ? t.slice(i + 3) : t;
        p.textContent = t.charAt(0).toUpperCase() + t.slice(1);
      };
      sync();
      new MutationObserver(sync).observe(sub, { childList: true, characterData: true, subtree: true });
      wrap.insertBefore(head, wrap.firstChild);
      document.documentElement.classList.add('has-pagehead');
    }
    // Comfortable / Compact
    var tools = document.querySelector('.top .tools');
    if (tools) {
      var db = document.createElement('button');
      db.type = 'button';
      db.className = 'btn densebtn';
      var setD = function (d, save) {
        document.documentElement.dataset.density = d;
        db.textContent = d === 'compact' ? 'Compact' : 'Comfortable';
        db.title = 'Rows and tiles are ' + d + '. Click for ' + (d === 'compact' ? 'comfortable' : 'compact') + '.';
        if (save) { try { localStorage.setItem('spr-density', d); } catch (e) {} }
      };
      setD(density, false);
      db.addEventListener('click', function () { setD(document.documentElement.dataset.density === 'compact' ? 'comfortable' : 'compact', true); });
      tools.insertBefore(db, tools.querySelector('#themeSeg'));
    }
    // a warning under the menu when SAP could not be reached (the page keeps its last data)
    var dot = document.getElementById('liveDot'), txt = document.getElementById('liveTxt');
    if (stick && dot && txt) {
      var nb = document.createElement('div');
      nb.className = 'netbanner';
      nb.hidden = true;
      nb.setAttribute('role', 'status');
      stick.appendChild(nb);
      var upd = function () {
        var bad = /--crit/.test(dot.getAttribute('style') || '');
        nb.hidden = !bad;
        if (bad) nb.textContent = 'Could not refresh from SAP. The page keeps showing the last data it has. ' + txt.textContent;
      };
      new MutationObserver(upd).observe(dot, { attributes: true, attributeFilter: ['style'] });
      new MutationObserver(upd).observe(txt, { childList: true, characterData: true, subtree: true });
    }
    // a menu that scrolls sideways shows the tab of this page
    if (nav && navOn && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = navOn.offsetLeft - nav.clientWidth / 2 + navOn.offsetWidth / 2;
  })();

  var q = document.getElementById('q');
  if (q) {
    if (!q.title) q.title = 'Press / to come here';
    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = document.activeElement && document.activeElement.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
      e.preventDefault();
      q.focus();
      q.select();
    });
  }

  // ---------------------------------------------------------------- numbers: "₹1.21 Cr", "₹39.27 L", "₹6,000", "1,234", "18 days"
  var UNIT = /^₹?\s*(-?[\d,]+(?:\.\d+)?)\s*(Cr|L)?$/;
  function num(text) {
    var m = UNIT.exec(text.trim());
    if (!m) return NaN;
    var v = parseFloat(m[1].replace(/,/g, ''));
    return m[2] === 'Cr' ? v * 1e7 : m[2] === 'L' ? v * 1e5 : v;
  }
  function inr(v) { // the same words as the pages: Cr, L, or whole rupees
    var a = Math.abs(v);
    if (a >= 1e7) return '₹' + (v / 1e7).toFixed(2) + ' Cr';
    if (a >= 1e5) return '₹' + (v / 1e5).toFixed(2) + ' L';
    return '₹' + Math.round(v).toLocaleString('en-IN');
  }
  var plain = function (v) { return Math.round(v).toLocaleString('en-IN'); };

  // ---------------------------------------------------------------- bars behind the value column
  var VALUE_HEAD = /value|amount|to deliver/i, NOT_VALUE = /price|share|lines|items|quantity|qty/i;
  function bars() {
    var tables = document.querySelectorAll('.tbox table');
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i], head = t.tHead && t.tHead.rows[0], body = t.tBodies[0];
      if (!head || !body) continue;
      var col = -1;
      for (var c = 0; c < head.cells.length; c++) {
        var h = head.cells[c].textContent;
        if (VALUE_HEAD.test(h) && !NOT_VALUE.test(h)) col = c;
      }
      if (col < 0) continue;
      var cells = [], vals = [], max = 0;
      for (var r = 0; r < body.rows.length; r++) {
        var cell = body.rows[r].cells[col];
        if (!cell || body.rows[r].cells.length <= col) continue;
        var v = num(cell.textContent);
        cells.push(cell);
        vals.push(v);
        if (v > max) max = v;
      }
      for (var k = 0; k < cells.length; k++) {
        if (max > 0 && vals[k] > 0) {
          cells[k].classList.add('hasbar');
          cells[k].style.setProperty('--w', Math.max(2, vals[k] / max * 100).toFixed(1) + '%');
        } else if (cells[k].classList.contains('hasbar')) {
          cells[k].classList.remove('hasbar');
          cells[k].style.removeProperty('--w');
        }
      }
    }
  }

  // ---------------------------------------------------------------- an icon on every tile
  var ICON_RULES = [
    [/going up|rises?\b/i, 'up'], [/going down|falls?\b/i, 'down'], [/\bloss\b/i, 'alert'], [/\bprofit\b/i, 'coin'], [/top 5|expensive/i, 'trophy'], [/invoice/i, 'box'], [/not used/i, 'moon'], [/blocked/i, 'lock'], [/quality/i, 'shield'], [/lines|items/i, 'box'], [/location/i, 'pin'], [/supplier/i, 'truck'],
    [/cost center/i, 'target'], [/quantity to check/i, 'alert'], [/approval/i, 'check'], [/day|oldest|waiting|overdue|older|passed/i, 'clock'],
    [/^acquisitions\b/i, 'box'], [/^(MAL|MCPL)\b/, 'coin'],
    [/value|amount|deliver|₹/i, 'coin'], [/material|purchase order|\bprs?\b|\bpos\b/i, 'box']
  ];
  function icons() {
    var tiles = document.querySelectorAll('.tile:not([data-ico]), .hero:not([data-ico])');
    for (var i = 0; i < tiles.length; i++) {
      var l = tiles[i].querySelector('.tl, .lab');
      if (!l) continue;
      var text = l.textContent, ico = 'spark';
      for (var r = 0; r < ICON_RULES.length; r++) if (ICON_RULES[r][0].test(text)) { ico = ICON_RULES[r][1]; break; }
      tiles[i].setAttribute('data-ico', ico);
    }
  }

  // ---------------------------------------------------------------- numbers that count up
  var last = {}; // tile label -> the number it showed last, so a filter change moves from the old number to the new one
  var NUMBER_TEXT = /^(₹?)(-?[\d,]+(?:\.\d+)?)(?:\s?(Cr|L))?(.*)$/;
  function countUps() {
    if (reduce) return;
    var els = document.querySelectorAll('.tile .tv, .hero .big');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.hasAttribute('data-cu')) continue;
      el.setAttribute('data-cu', '1');
      var text = el.textContent.trim(), m = NUMBER_TEXT.exec(text);
      if (!m) continue;
      var tile = el.closest('.tile, .hero'), lab = tile && tile.querySelector('.tl, .lab');
      var key = location.pathname + '|' + (lab ? lab.textContent.trim().slice(0, 50) : i);
      var isInr = m[1] === '₹', target = num(m[1] + m[2] + (m[3] ? ' ' + m[3] : ''));
      if (!isFinite(target)) continue;
      var from = last[key] === undefined ? 0 : last[key];
      last[key] = target;
      if (from === target || document.hidden) continue;
      animate(el, text, from, target, isInr, m[4] || '');
    }
  }
  function animate(el, finalText, from, to, isInr, suffix) {
    var t0 = null, dur = 650;
    el.setAttribute('data-cu-busy', '1');
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - p, 3), v = from + (to - from) * e;
      if (p < 1) {
        el.textContent = (isInr ? inr(v) : plain(v)) + suffix;
        requestAnimationFrame(step);
      } else {
        el.textContent = finalText; // the exact text the page wrote
        el.removeAttribute('data-cu-busy');
      }
    }
    requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- charts above the summary tables
  var PALETTE = ['#0E7FAE', '#7CC8E8', '#2A78D6', '#BFE3F4', '#0B5E87', '#4FB3E0', '#6DA7EC', '#3E5C76']; // the one blue of the dashboard in light and dark steps
  var OTHER = '#94A3B8';
  // Pending Purchase Orders: the Delivery filter decides what a bar is. "Pending delivery" (the default) = Value to be delivered (the same as the tile Pending value), "All" = Net value.
  // Net value of a pending item also holds what is already received, so on the pending list it is more than the pending value (user, 5-Nov-2026: "Graph me value galt kyu aa rha hai").
  function poVal() { var s = document.getElementById('delSel'); return s && s.value === 'every' ? /net value/i : /value to be delivered/i; }
  // page -> table container -> chart. col: which column to draw (a header test, or a function that gives it); rev: the table lists the newest first; note: write the name of the column above the chart
  var CHARTS = {
    '/issue': [{ id: 'byAge', col: /value/i }, { id: 'byMonth', col: /value/i, rev: true }, { id: 'byDay', col: /value/i }],
    '/po': [{ id: 'byAge', col: /value to be delivered/i }, { id: 'byMonth', col: poVal, rev: true, note: true }, { id: 'byDay', col: poVal, note: true }],
    '/invoice': [{ id: 'byAge', col: /^items$/i }, { id: 'byMonth', col: /^items$/i, rev: true }, { id: 'byDay', col: /^items$/i }],
    '/purchase': [{ id: 'byAge', col: /net value/i }, { id: 'byLead', col: /net value/i }, { id: 'byMonth', col: /net value/i, rev: true }, { id: 'byDay', col: /net value/i }],
    '/asset': [{ id: 'byAge', col: /^amount$/i }, { id: 'byMonth', col: /^amount$/i, rev: true }, { id: 'byDay', col: /^amount$/i }],
    '/ageing': [{ id: 'byAgeG', col: /^amount$/i }, { id: 'byAgeT', col: /^amount$/i }],
    '/stock': [{ id: 'byIdle', col: /stock value/i }]
  };
  function readTable(box, colTest, rev) {
    var t = box.querySelector('table');
    if (!t || !t.tHead || !t.tBodies[0]) return null;
    var head = t.tHead.rows[0], col = -1, test = typeof colTest === 'function' ? colTest() : colTest;
    for (var c = 0; c < head.cells.length; c++) if (test.test(head.cells[c].textContent.trim())) col = c;
    if (col < 0) return null;
    var rows = [], money = false;
    for (var r = 0; r < t.tBodies[0].rows.length; r++) {
      var row = t.tBodies[0].rows[r], cell = row.cells[col];
      if (row.classList.contains('storerow')) continue; // a subtotal row is not a slice of the chart
      if (!cell || row.cells.length <= col) continue;
      var v = num(cell.textContent);
      if (!isFinite(v)) continue;
      if (cell.textContent.indexOf('₹') >= 0) money = true;
      var link = row.querySelector('button.lnk');
      rows.push({ label: row.cells[0].textContent.trim(), value: v, text: cell.textContent.trim(), link: link, sel: row.classList.contains('sel') });
    }
    if (rev) rows.reverse();
    return { rows: rows, money: money, colName: head.cells[col].textContent.trim().replace(/\s+/g, ' ') };
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function short(label, roomy, per) { // "Oct 2026" -> "Oct 26", "01 Oct 2026" -> "1" (with room: "01 Oct"), "16–30 days" -> "16–30" in a narrow column
    var m = /^(\w{3,5}) (\d{4})/.exec(label);
    if (m) return m[1].slice(0, 3) + ' ' + m[2].slice(2);
    m = /^(\d{1,2}) (\w{3,4}) \d{4}$/.exec(label);
    if (m) return roomy ? ('0' + parseInt(m[1], 10)).slice(-2) + ' ' + m[2].slice(0, 3) : String(parseInt(m[1], 10));
    m = /^(\d+(?:–\d+)?) days$/.exec(label);
    if (m && per && per < 80) return m[1];
    if (label === 'Over 1 year' && per && per < 80) return '>1 yr';
    return label;
  }
  function columns(data, width) {
    var rows = data.rows, max = 0, i, H = 168;  // H = the height of .uc-cols in ui.css
    for (i = 0; i < rows.length; i++) if (rows[i].value > max) max = rows[i].value;
    var per = (width || 320) / Math.max(1, rows.length);
    var step = per >= 36 ? 1 : per >= 24 ? 2 : per >= 16 ? 3 : 5;
    // a value is about 7 px per character (bold): when it does not fit across its column it is written upright (it reads from the bottom up) and the bars get a little lower
    var maxLen = 0;
    for (i = 0; i < rows.length; i++) if (String(rows[i].text).length > maxLen) maxLen = String(rows[i].text).length;
    var textW = Math.ceil(maxLen * 7.1) + 4, rot = textW > per - 8;
    var roomy = per >= 44, labs = [], wrapAny = false;
    for (i = 0; i < rows.length; i++) { labs.push(short(rows[i].label, roomy, per)); if (labs[i].length > 11) wrapAny = true; }
    var valH = rot ? textW + 4 : 16, labH = wrapAny ? 40 : 18;
    var barMax = Math.max(24, H - valH - labH - 10);   // the value, the bar and the name together fit the height of the chart
    // a few bars (two days, three groups) stay together in the middle instead of being spread over the whole width; with little room the last label is moved to the right edge
    var h = '<div class="uc-cols' + (rows.length <= 8 && per >= 110 ? ' few' : '') + (per < 40 ? ' dense' : '') + '">';
    for (i = 0; i < rows.length; i++) {
      var r = rows[i], px = max > 0 && r.value > 0 ? Math.max(3, Math.round(r.value / max * barMax)) : 0;
      var showLab = (rows.length - 1 - i) % step === 0, sl = labs[i];
      h += '<button type="button" class="uc-col' + (r.sel ? ' sel' : '') + '" data-i="' + i + '" title="' + esc(r.label + ': ' + r.text) + '">' +
        '<span class="uc-val' + (rot ? ' rot' : '') + '">' + esc(r.text) + '</span>' +
        '<span class="uc-bar" style="height:' + px + 'px"></span><span class="uc-lab' + (sl.length > 11 && showLab ? ' uc-wrap' : '') + '">' + (showLab ? esc(sl) : '&nbsp;') + '</span></button>';
    }
    return h + '</div>';
  }
  function charts() {
    var cfg = CHARTS[location.pathname];
    if (!cfg) return;
    for (var n = 0; n < cfg.length; n++) {
      var c = cfg[n], box = document.getElementById(c.id);
      if (!box || !box.classList.contains('tbox')) continue;
      var data = readTable(box, c.col, c.rev);
      var host = box._uc;
      if (!data || !data.rows.length) { if (host) host.hidden = true; continue; }
      if (!host) {
        host = document.createElement('div');
        host.className = 'uichart uichart-cols';
        box.parentNode.insertBefore(host, box);
        box._uc = host;
        // a click on a bar does what the table row does
        host.addEventListener('click', function (e) {
          var el = e.target.closest('[data-i]');
          if (!el || !this._rows) return;
          var item = this._rows[+el.getAttribute('data-i')];
          if (item && item.link) item.link.click();
        });
      }
      host.hidden = false;
      if (window.ResizeObserver && !host._ro) {
        // one observer per chart (the variable `host` of this loop is shared by all charts, so the chart is passed in)
        (function (h) {
          h._ro = new ResizeObserver(function () {
            if (Math.abs(h.clientWidth - (h._w || 0)) > 6) { clearTimeout(h._rt); h._rt = setTimeout(charts, 120); }
          });
          h._ro.observe(h);
        })(host);
      }
      // the width of the chart itself (a card can put the chart beside another one), not of the table under it
      host._w = host.clientWidth || 0;
      var inner = columns(data, host.clientWidth || box.clientWidth);
      if (!inner) { host.hidden = true; continue; }
      if (c.note) inner = '<div class="uc-note">Bars: ' + esc(data.colName) + '</div>' + inner;
      host._rows = data.rows;
      // draw again only when something changed, so the charts do not replay their animation on every keystroke
      var sig = inner;
      if (host._sig !== sig) { host.innerHTML = inner; host._sig = sig; }
    }
  }

  // ---------------------------------------------------------------- download a table as CSV (opens in Excel)
  var PAGE_SLUG = { '/': 'pending-pr', '/issue': 'store-issue', '/po': 'purchase-orders', '/po-approval': 'po-approval', '/purchase': 'purchase', '/invoice': 'pending-invoice-entry', '/ageing': 'payment-ageing', '/price': 'price-variance', '/stock': 'store-stock', '/asset': 'capital-issue' }[location.pathname];
  function slug(t) { return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'table'; }
  function cardTitle(card) {
    var h = card.querySelector('h2');
    if (!h) return 'table';
    var c = h.cloneNode(true);
    [].forEach.call(c.querySelectorAll('.sec-badge,.csvbtn,.opn,.foldbtn,.seg'), function (e) { e.remove(); });
    return c.textContent.trim() || 'table';
  }
  function mainTables(card) { // the tables of a card, not the little tables inside an opened row
    var out = [];
    [].forEach.call(card.querySelectorAll('.tscroll table, .tbox table'), function (t) {
      if (!t.parentElement.closest('table') && t.tBodies[0] && out.indexOf(t) < 0) out.push(t);
    });
    return out;
  }
  function field(v) { v = String(v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function csvCell(td) { // "₹1.21 Cr" and "₹39.27 L" become whole rupees, so Excel can add them up; everything else stays as shown
    if (td.getAttribute('data-full') !== null) return td.getAttribute('data-full') || '–'; // a cell that shows only the first lines of a list keeps the whole list here
    var c = td;
    if (td.querySelector('br')) { // a line break must not glue the words together: " + " in a list of quantities (class qlist), else a space
      c = td.cloneNode(true);
      [].forEach.call(c.querySelectorAll('br'), function (b) { b.replaceWith(td.classList.contains('qlist') ? ' + ' : ' '); });
    }
    var t = c.textContent.replace(/\s+/g, ' ').trim();
    if (/^₹?\s*-?[\d,]+(\.\d+)?\s*(Cr|L)$/.test(t) || /^₹\s*-?[\d,]+(\.\d+)?$/.test(t)) {
      var v = num(t);
      if (isFinite(v)) return String(Math.round(v * 100) / 100);
    }
    return t;
  }
  function tableLines(t) {
    var lines = [], hr = t.tHead && t.tHead.rows[0];
    if (hr) lines.push([].map.call(hr.cells, function (c) { return field(c.textContent.replace(/\s+/g, ' ').trim().replace(/ [▲▼]$/, '')); }).join(','));
    [].forEach.call(t.tBodies[0].rows, function (r) {
      if (r.classList.contains('subrow') || (r.cells.length === 1 && r.cells[0].classList.contains('empty'))) return;
      lines.push([].map.call(r.cells, function (c) { return field(csvCell(c)); }).join(','));
    });
    return lines;
  }
  function rowCount(card) { return card.querySelectorAll('.tscroll table > tbody > tr:not(.subrow), .tbox table > tbody > tr:not(.subrow)').length; }
  function openAll(card, maxMs) { // a list that shows only its first rows is opened to every row first; resolves with a function that puts it back
    var btn = card.querySelector('#seeAll,#tileAll,[data-seeall]');
    if (!btn || btn.hidden || !/^See all/i.test(btn.textContent)) return Promise.resolve(function () {});
    var n = parseInt(btn.textContent.replace(/[^\d]/g, ''), 10) || 0;
    btn.click();
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function wait() {
        if ((n && rowCount(card) >= n) || Date.now() - t0 > (maxMs || 9000)) {
          return resolve(function () {
            var b = card.querySelector('#seeAll,#tileAll,[data-seeall]');
            if (b && /^Show first/i.test(b.textContent)) b.click();
          });
        }
        setTimeout(wait, 150);
      })();
    });
  }
  function download(name, text) {
    var blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function exportCard(card, btn) {
    btn.disabled = true;
    openAll(card).then(function (restore) {
      var out = [];
      var tabs = mainTables(card);
      tabs.forEach(function (t, i) {
        if (i) out.push('');
        if (tabs.length > 1) { // the small heading above a table (a tile's details hold several tables)
          var h = t.previousElementSibling;
          if (!h || !/^H3$/.test(h.tagName)) { h = t.closest('.tbox') && t.closest('.tbox').previousElementSibling; }
          if (h && /^H3$/.test(h.tagName)) out.push(field(h.textContent.trim()));
        }
        out = out.concat(tableLines(t));
      });
      var d = new Date(), stamp = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
      if (out.length) download(PAGE_SLUG + '_' + slug(cardTitle(card)) + '_' + stamp + '.csv', out.join('\r\n'));
      restore();
      btn.disabled = false;
    });
  }
  // On these pages the button of a card downloads the card as a PDF (the same look as the Download menu: the list as on the screen and, where the page hands them over, the details of every
  // row opened) and not as a CSV (user, 29-Oct-2026, Price Variance: "CSV pe click karu to PDF me download ho, same format me, material khul jana chahiye")
  var CARD_PDF_PAGES = ['/price'];
  function exportCardPdf(card, btn) {
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparing…';
    var ok = false;
    openAll(card, 120000).then(function (restore) {
      var bl = cardBlocks(card), rows = 0;
      restore();
      if (!bl.length) { btn.textContent = 'Nothing to download'; return; }
      bl.forEach(function (b) { rows += b.rows.length; });
      var name = cardTitle(card), hint = card.querySelector('.hint');
      var d = docInfo(name.split(' · ')[0].replace(/\s+/g, ' ').trim(), ['Rows: ' + rows.toLocaleString('en-IN')]);
      if (hint && hint.textContent.trim()) d.desc = hint.textContent.replace(/\s+/g, ' ').trim(); // the line under the heading of the card says what the list holds
      d.blocks = bl;
      return buildPdf(d).then(function (blob) { saveBlob(PAGE_SLUG + '_' + slug(name) + '_' + stampNow().file + '.pdf', blob); ok = true; });
    }).catch(function () { btn.textContent = 'Download failed'; }).then(function () {
      btn.disabled = false;
      if (ok) btn.textContent = label; else setTimeout(function () { if (!btn.disabled) btn.textContent = label; }, 2500);
    });
  }
  function csvButtons() {
    if (!PAGE_SLUG) return;
    var asPdf = CARD_PDF_PAGES.indexOf(location.pathname) >= 0;
    var cards = document.querySelectorAll('.card');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i], h = card.querySelector('h2');
      if (card.hasAttribute('data-csv') || !h || !mainTables(card).length) continue;
      card.setAttribute('data-csv', '1');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'csvbtn';
      b.textContent = asPdf ? 'PDF' : 'CSV';
      b.title = asPdf ? 'Download this card as a PDF file (the list with the details of every material)' : 'Download this table as a CSV file (opens in Excel)';
      b.addEventListener('click', (asPdf ? exportCardPdf : exportCard).bind(null, card, b));
      h.appendChild(b);
    }
  }

  // ---------------------------------------------------------------- download: Summary and Details as PDF files (the Download menu in the header)
  // The PDF is drawn to look like the dashboard: the Mittal logo, the page colour, the status chip, the filter chips, tiles with their icon and colour, cards with a coloured top edge and a numbered badge,
  // tables with a tinted heading row. Summary = the tiles and every summary table; Details = every row of the list, both under the filters that are set now.
  // It is written here in the browser (standard fonts, no library, no call to the server), so it follows the filters on the screen.
  var ICO_COLOR = { alert: '#D03B3B', up: '#D03B3B', down: '#0CA30C' }; // every other tile is the colour of the page (blue); only alert / price up is red and price down is green, as on the screen
  function hexRgb(h) { return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]; }
  function rgbHex(c) { return '#' + c.map(function (v) { return ('0' + Math.round(v * 255).toString(16)).slice(-2); }).join(''); }
  function cssRgb(v, fb) {
    v = (v || '').trim();
    var m = /^#([0-9a-f]{6})$/i.exec(v);
    if (m) return hexRgb(v);
    m = /^rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(v);
    return m ? [m[1] / 255, m[2] / 255, m[3] / 255] : fb;
  }
  function cellText(td) {
    if (td.getAttribute('data-full') !== null) return td.getAttribute('data-full') || '–';
    var c = td;
    if (td.querySelector('br, div, svg')) { // a line break or a block must not glue the words together; a small chart (svg) has only a tooltip text
      c = td.cloneNode(true);
      [].forEach.call(c.querySelectorAll('svg'), function (v) { v.remove(); });
      [].forEach.call(c.querySelectorAll('br'), function (b) { b.replaceWith(td.classList.contains('qlist') ? ' + ' : ' '); });
      [].forEach.call(c.querySelectorAll('div'), function (d) { d.insertAdjacentText('beforebegin', ' '); });
    }
    return c.textContent.replace(/\s+/g, ' ').trim();
  }
  function tableData(t) { // { head, rows, foot } of a table, every cell as it is shown (a foot cell may span columns)
    var head = [], rows = [], foot = [], hr = t.tHead && t.tHead.rows[0];
    if (hr) head = [].map.call(hr.cells, function (c) { return c.textContent.replace(/\s+/g, ' ').trim().replace(/ [▲▼]$/, ''); });
    [].forEach.call(t.tBodies[0].rows, function (r) {
      if (r.classList.contains('subrow') || (r.cells.length === 1 && r.cells[0].classList.contains('empty'))) return;
      rows.push([].map.call(r.cells, cellText));
    });
    if (t.tFoot) [].forEach.call(t.tFoot.rows, function (r) { foot.push([].map.call(r.cells, function (c) { return { t: cellText(c), s: c.colSpan || 1 }; })); });
    if (!head.length && rows.length) head = rows[0].map(function () { return ''; });
    var empty = head.map(function (h, c) { return rows.length > 0 && rows.every(function (r) { return !r[c]; }); });
    if (empty.some(Boolean)) { // a column without any text (a small chart) is left out; a Total cell that spanned it gets narrower
      head = head.filter(function (h, c) { return !empty[c]; });
      rows = rows.map(function (r) { return r.filter(function (x, c) { return !empty[c]; }); });
      foot = foot.map(function (r) { var c0 = 0, out = []; r.forEach(function (x) { var keep = 0; for (var c = c0; c < c0 + x.s; c++) if (!empty[c]) keep++; if (keep) out.push({ t: x.t, s: keep }); c0 += x.s; }); return out; });
    }
    return { type: 'table', head: head, rows: rows, foot: foot };
  }
  function cardBlocks(card) { // the table (or tables) of a card with its heading, its number and its colour as on the screen
    var out = [], tabs = mainTables(card), title = cardTitle(card), badge = card.querySelector('.sec-badge'), cc = cssRgb(getComputedStyle(card).getPropertyValue('--cc'), null);
    tabs.forEach(function (t, i) {
      var d = tableData(t), sub = '';
      if (tabs.length > 1) {
        var h = t.previousElementSibling;
        if (!h || !/^H3$/.test(h.tagName)) h = t.closest('.tbox') && t.closest('.tbox').previousElementSibling;
        if (h && /^H3$/.test(h.tagName)) sub = h.textContent.trim();
      }
      d.title = i === 0 ? title + (sub ? ' · ' + sub : '') : sub;
      d.badge = i === 0 && badge ? badge.textContent.trim() : '';
      d.accent = cc;
      if (d.rows.length || d.foot.length) out.push(d);
    });
    var extra = typeof window.PDF_DETAILS === 'function' ? window.PDF_DETAILS(card) : null;
    if (extra && extra.length) { // the page's own blocks for this card (Price Variance: the list as on the screen with every material opened under its row)
      extra.forEach(function (b, i) { b.accent = cc; b.badge = i === 0 && badge ? badge.textContent.trim() : ''; b.title = i === 0 ? title : ''; });
      return extra;
    }
    return out.concat(panelBlocks(card, cc));
  }
  // A material (Price Variance) or a party (Payment Ageing) that is opened under its row has a panel (.mp): its figures and its tables go into the PDF after the tables of the card,
  // in the same look (user, 29-Oct-2026: "khule material ka graph aur PO dates bhi PDF me"). The graph itself is a drawing: its numbers are the table of PO dates.
  function panelBlocks(card, accent) {
    var out = [];
    [].forEach.call(card.querySelectorAll('.mp'), function (p) {
      var head = p.querySelector('.mph'), b = head && head.querySelector('b'), sm = head && head.querySelector('.sm');
      var title = (b ? b.textContent.replace(/\s+/g, ' ').trim() : 'Details') + (sm ? ' · ' + sm.textContent.replace(/\s+/g, ' ').trim() : '');
      var first = true;
      var stats = p.querySelectorAll('.stats .stat');
      if (stats.length) {
        var st = { type: 'table', head: [], rows: [[]], foot: [], title: title, badge: '', accent: accent };
        [].forEach.call(stats, function (s) {
          var v = [].filter.call(s.children, function (c) { return c.tagName === 'B'; })[0], l = [].filter.call(s.children, function (c) { return c.tagName === 'SPAN'; })[0]; // the label and the value are the direct children (the value may hold spans of its own)
          st.head.push(l ? l.textContent.replace(/\s+/g, ' ').trim() : '');
          st.rows[0].push(v ? cellText(v) : '');
        });
        out.push(st);
        first = false;
      }
      [].forEach.call(p.querySelectorAll('.tbox table'), function (t) {
        var anc = t.parentElement.closest('table');
        if ((anc && p.contains(anc)) || !t.tBodies[0]) return;
        var d = tableData(t), h = t.closest('.tbox') && t.closest('.tbox').previousElementSibling, sub = h && /^H3$/.test(h.tagName) ? h.textContent.replace(/\s+/g, ' ').trim() : '';
        d.title = first ? title + (sub ? ' · ' + sub : '') : sub;
        d.badge = '';
        d.accent = accent;
        if (d.rows.length || d.foot.length) { out.push(d); first = false; }
      });
    });
    return out;
  }
  function filtersList() { // the filters that are set, as the page shows them
    var out = [];
    [].forEach.call(document.querySelectorAll('.bar[aria-label="Filters"] .fld'), function (f) {
      var lab = f.querySelector('span'), c = f.querySelector('select,input');
      if (!lab || !c) return;
      var v = c.tagName === 'SELECT' ? (c.selectedOptions[0] ? c.selectedOptions[0].textContent.trim() : '') : (c.value || '').trim();
      if (v && !/^(All|Every)\b/i.test(v)) out.push(lab.textContent.trim() + ': ' + v);
    });
    return out;
  }
  function tileItems(scope) { // the tiles of the page (or of one card of the Summary): label, value as shown, icon
    var items = [];
    [].forEach.call((scope || document).querySelectorAll('.tile:not(.sk), .hero'), function (t) {
      if (!scope && t.closest('.card')) return;
      var v = t.querySelector('.tv, .big, .gtv'), l = t.querySelector('.tl, .lab, .gtn');
      if (!v && !l) return;
      var ti = (getComputedStyle(t).getPropertyValue('--ti') || '').trim(), m = /^url\(["']?(.*?)["']?\)$/.exec(ti);
      items.push({ label: l ? (l.innerText || l.textContent).replace(/\s*\n\s*/g, ' · ').replace(/\s+/g, ' ').trim() : '', value: v ? v.textContent.replace(/\s+/g, ' ').trim() : '', ico: t.getAttribute('data-ico') || 'spark', ti: m ? m[1] : '', hero: t.classList.contains('hero') });
    });
    return items;
  }
  function pageName() { var on = document.querySelector('.nav a.on'); return on ? on.textContent.trim() : document.title; }
  function stampNow() {
    var d = new Date(), p = function (n) { return ('0' + n).slice(-2); };
    return { file: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()), text: p(d.getDate()) + '-' + p(d.getMonth() + 1) + '-' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) };
  }
  function docInfo(kind, chips) {
    var live = document.getElementById('liveTxt'), desc = document.querySelector('.pagehead p');
    var cs = getComputedStyle(document.documentElement), c1 = cssRgb(cs.getPropertyValue('--pc'), [0.055, 0.561, 0.796]), c2 = cssRgb(cs.getPropertyValue('--pc2'), c1);
    return { page: pageName(), kind: kind, desc: desc ? desc.textContent.replace(/\s+/g, ' ').trim() : '', live: live ? live.textContent.replace(/\s+/g, ' ').trim() : '', filters: filtersList(), chips: chips || [], downloaded: stampNow().text, pc: c1, pc2: c2 };
  }

  // ---- the PDF file (A4 landscape, A3 landscape for a very wide list; Helvetica, so the rupee sign is written as Rs)
  var WINANSI = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, '‰': 0x89, '‹': 0x8b, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99, '›': 0x9b };
  function norm(s) { return String(s === undefined || s === null ? '' : s).replace(/₹\s?/g, 'Rs ').replace(/Rs \)/g, 'Rs)').replace(/▲/g, 'up ').replace(/▼/g, 'down ').replace(/[−‐‑‒]/g, '-').replace(/[▸▾]/g, '').replace(/★/g, '*').replace(/↳/g, '>').replace(/[→›]/g, '>').replace(/\s+/g, ' ').trim(); }
  function pdfBytes(s) { // one byte per character (WinAnsi); what the standard fonts cannot show becomes ?
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i), ch = s.charAt(i);
      var base = c > 255 ? ch.normalize('NFD').charAt(0) : ''; // a letter with an accent the font does not have is drawn without it
      out += (c >= 32 && c < 127) || (c >= 160 && c <= 255) ? ch : WINANSI[ch] !== undefined ? String.fromCharCode(WINANSI[ch]) : c < 32 ? ' ' : /^[A-Za-z]$/.test(base) ? base : '?';
    }
    return out;
  }
  function pdfStr(s) { return '(' + pdfBytes(s).replace(/[\\()]/g, '\\$&') + ')'; }
  var MEAS = null;
  function textW(s, size, bold) { // Arial has the widths of Helvetica
    if (!MEAS) {
      MEAS = [document.createElement('canvas').getContext('2d'), document.createElement('canvas').getContext('2d')];
      MEAS[0].font = '100px Arial, Helvetica, sans-serif';
      MEAS[1].font = 'bold 100px Arial, Helvetica, sans-serif';
    }
    return MEAS[bold ? 1 : 0].measureText(s).width * size / 100;
  }
  function wrapText(s, maxW, size, bold, maxLines) {
    if (textW(s, size, bold) <= maxW) return [s];
    var words = s.split(' '), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var w = words[i], test = cur ? cur + ' ' + w : w;
      if (textW(test, size, bold) <= maxW) { cur = test; continue; }
      if (cur) { lines.push(cur); cur = ''; }
      while (w.length > 1 && textW(w, size, bold) > maxW) { // a word longer than the cell is cut
        var k = w.length;
        while (k > 1 && textW(w.slice(0, k), size, bold) > maxW) k--;
        lines.push(w.slice(0, k));
        w = w.slice(k);
      }
      cur = w;
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (last.length > 1 && textW(last + '...', size, bold) > maxW) last = last.slice(0, -1);
      lines[maxLines - 1] = last + '...';
    }
    return lines;
  }
  var NUMLIKE = /^[-+]?(Rs )?[\d,]+(\.\d+)?( ?(Cr|L|%))?$/;
  function colInfo(t, size) { // natural and smallest width of every column, and which columns hold numbers (right aligned)
    if (t._ci && t._ci.size === size) return t._ci;
    var n = t.head.length, sample = t.rows.slice(0, 250), nat = [], min = [], num = [], minSum = 0;
    for (var c = 0; c < n; c++) {
      var h = norm(t.head[c]).toUpperCase(), nw = Math.min(textW(h, size, true), 64), mw = 0, hits = 0, filled = 0;
      h.split(' ').forEach(function (w) { mw = Math.max(mw, textW(w, size, true)); });
      for (var r = 0; r < sample.length; r++) {
        var x = norm(sample[r][c]);
        if (!x) continue;
        filled++;
        if (NUMLIKE.test(x) || x === '-') hits++;
        nw = Math.max(nw, textW(x, size, false));
        x.split(' ').forEach(function (w) { mw = Math.max(mw, textW(w, size, false)); });
      }
      num[c] = filled > 0 && hits / filled >= 0.8;
      nat[c] = Math.min(nw, 240) + 8;
      min[c] = num[c] ? nat[c] : Math.min(nat[c], Math.max(mw + 8, 26));
      minSum += min[c];
    }
    return (t._ci = { size: size, nat: nat, min: min, num: num, minSum: minSum });
  }
  function fitCols(ci, avail) {
    var sn = 0, sm = 0, w = [], i;
    ci.nat.forEach(function (x) { sn += x; });
    ci.min.forEach(function (x) { sm += x; });
    if (sn <= avail) { var k = Math.min(avail / sn, 2.2); return ci.nat.map(function (x) { return x * k; }); }
    var deficit = sn - avail, room = sn - sm;
    if (room >= deficit) { for (i = 0; i < ci.nat.length; i++) w[i] = ci.nat[i] - (ci.nat[i] - ci.min[i]) * deficit / room; return w; }
    return ci.min.map(function (x) { return x * avail / sm; });
  }
  function toU8(str) { var u = new Uint8Array(str.length); for (var i = 0; i < str.length; i++) u[i] = str.charCodeAt(i) & 255; return u; }
  function deflate(u8) {
    if (!window.CompressionStream) return Promise.resolve(null);
    return new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function loadImg(src) { return new Promise(function (res) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = src; }); }
  function rgbaOf(img, w, h, fix) { var c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h); var d = x.getImageData(0, 0, w, h); if (fix) fix(d.data); return { w: w, h: h, data: d.data }; }
  function mixWhite(c, k) { return [1 - (1 - c[0]) * k, 1 - (1 - c[1]) * k, 1 - (1 - c[2]) * k]; }
  function mixCols(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function iconSvg(ti, col) { // the icon of a tile (the same drawing as on the screen) in the colour wanted
    var m = /^data:image\/svg\+xml,(.*)$/.exec(ti);
    if (!m) return '';
    var svg = decodeURIComponent(m[1]).replace(/stroke='black'/g, "stroke='" + rgbHex(col) + "'").replace('<svg ', "<svg width='96' height='96' ");
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function buildPdf(doc) { // doc = { page, kind, desc, live, filters, chips, downloaded, blocks: [ {type:'section',title,accent} | {type:'tiles',items} | {type:'table',title,badge,accent,head,rows,foot} ] } -> Promise of a Blob
    var hex = (getComputedStyle(document.documentElement).getPropertyValue('--pc') || '').trim(), hex2 = (getComputedStyle(document.documentElement).getPropertyValue('--pc2') || '').trim();
    var pc = cssRgb(hex, [0.055, 0.561, 0.796]), pc2 = cssRgb(hex2, pc);
    var BG = [0.957, 0.965, 0.961], WHITE = [1, 1, 1], BORDER = [0.86, 0.87, 0.89], INK = [0.1, 0.1, 0.12], GRAY = [0.4, 0.4, 0.45], RED = [0.894, 0.133, 0.153], GREEN = [0.047, 0.639, 0.047];
    var M = 28, size = 7.5, W = 841.89, H = 595.28, title = doc.page === 'Summary' ? 'Summary' : doc.page + ' · ' + doc.kind.charAt(0).toUpperCase() + doc.kind.slice(1);
    var tables = doc.blocks.filter(function (b) { return b.type === 'table'; }), need = 0;
    tables.forEach(function (t) { need = Math.max(need, colInfo(t, size).minSum); });
    if (need > W - 2 * M) { W = 1190.55; H = 841.89; }
    var avail = W - 2 * M;
    if (need > avail) size = Math.max(5.5, size * avail / need);
    // images first: the logo (the white lettering made dark, the page is white) and the icons of the tiles
    var IM = [], imgIndex = {}, jobs = [];
    function wantIcon(it, col) { var key = it.ico + '|' + rgbHex(col); if (imgIndex[key] === undefined && it.ti) { imgIndex[key] = null; jobs.push(loadImg(iconSvg(it.ti, col)).then(function (img) { if (img) { imgIndex[key] = IM.length; IM.push(rgbaOf(img, 96, 96)); } })); } return key; }
    doc.blocks.forEach(function (b) { if (b.type === 'tiles') b.items.forEach(function (it) { it.key = wantIcon(it, it.hero ? WHITE : (ICO_COLOR[it.ico] ? hexRgb(ICO_COLOR[it.ico]) : pc)); }); });
    doc.blocks.forEach(function (b) { if (b.type === 'chartrow') b.cards.forEach(function (c) { c.imgs.forEach(function (im) { im.idx = IM.length; IM.push({ w: im.w, h: im.h, data: im.data }); }); }); });  // the pictures of the graphs
    var logoEl = document.querySelector('.logo'), logoIdx = -1;
    if (logoEl) jobs.push(loadImg(logoEl.currentSrc || logoEl.src).then(function (img) {
      if (!img) return;
      logoIdx = IM.length;
      IM.push(rgbaOf(img, 300, 300, function (d) { for (var i = 0; i < d.length; i += 4) { if (d[i + 3] > 0 && Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) < 40 && Math.min(d[i], d[i + 1], d[i + 2]) > 120) { d[i] = 22; d[i + 1] = 22; d[i + 2] = 26; } } }));
    }));
    return Promise.all(jobs).then(function () { return layout(); });

    function layout() {
      var pages = [], cur = null, y = 0, bottom = H - M - 8;
      var f2 = function (v) { return v.toFixed(2); }, col3 = function (c) { return c[0].toFixed(3) + ' ' + c[1].toFixed(3) + ' ' + c[2].toFixed(3); };
      function rr(x, top, w, h, rt, rb) { // path of a rounded rectangle (top corners rt, bottom corners rb)
        rb = rb === undefined ? rt : rb;
        rt = Math.min(rt, w / 2, h / 2); rb = Math.min(rb, w / 2, h / 2);
        var x0 = x, x1 = x + w, y0 = H - top - h, y1 = H - top, kt = rt * 0.5523, kb = rb * 0.5523;
        return f2(x0 + rb) + ' ' + f2(y0) + ' m ' + f2(x1 - rb) + ' ' + f2(y0) + ' l ' +
          f2(x1 - rb + kb) + ' ' + f2(y0) + ' ' + f2(x1) + ' ' + f2(y0 + rb - kb) + ' ' + f2(x1) + ' ' + f2(y0 + rb) + ' c ' +
          f2(x1) + ' ' + f2(y1 - rt) + ' l ' +
          f2(x1) + ' ' + f2(y1 - rt + kt) + ' ' + f2(x1 - rt + kt) + ' ' + f2(y1) + ' ' + f2(x1 - rt) + ' ' + f2(y1) + ' c ' +
          f2(x0 + rt) + ' ' + f2(y1) + ' l ' +
          f2(x0 + rt - kt) + ' ' + f2(y1) + ' ' + f2(x0) + ' ' + f2(y1 - rt + kt) + ' ' + f2(x0) + ' ' + f2(y1 - rt) + ' c ' +
          f2(x0) + ' ' + f2(y0 + rb) + ' l ' +
          f2(x0) + ' ' + f2(y0 + rb - kb) + ' ' + f2(x0 + rb - kb) + ' ' + f2(y0) + ' ' + f2(x0 + rb) + ' ' + f2(y0) + ' c h ';
      }
      var C = {
        rect: function (x, top, w, h, c) { cur.push(col3(c) + ' rg ' + f2(x) + ' ' + f2(H - top - h) + ' ' + f2(w) + ' ' + f2(h) + ' re f\n'); },
        rrect: function (x, top, w, h, r, fill, stroke, sw, rb) { cur.push((fill ? col3(fill) + ' rg ' : '') + (stroke ? col3(stroke) + ' RG ' + (sw || 0.6) + ' w ' : '') + rr(x, top, w, h, r, rb) + (fill && stroke ? 'B' : fill ? 'f' : 'S') + '\n'); },
        outline: function (x, top, w, h, c) { cur.push(col3(c) + ' RG 0.6 w ' + f2(x) + ' ' + f2(H - top - h) + ' ' + f2(w) + ' ' + f2(h) + ' re S\n'); },
        poly: function (pts, c, lw, dash) { // a line through points [[x, top], ...], optionally dashed
          if (pts.length < 2) return;
          var q = col3(c) + ' RG ' + (lw || 1) + ' w 1 j 1 J ' + (dash ? '[' + dash.join(' ') + '] 0 d ' : '') + f2(pts[0][0]) + ' ' + f2(H - pts[0][1]) + ' m ';
          for (var i = 1; i < pts.length; i++) q += f2(pts[i][0]) + ' ' + f2(H - pts[i][1]) + ' l ';
          cur.push(q + 'S [] 0 d\n');
        },
        polyFill: function (pts, c) {
          var q = col3(c) + ' rg ' + f2(pts[0][0]) + ' ' + f2(H - pts[0][1]) + ' m ';
          for (var i = 1; i < pts.length; i++) q += f2(pts[i][0]) + ' ' + f2(H - pts[i][1]) + ' l ';
          cur.push(q + 'h f\n');
        },
        line: function (x1, x2, top, c, lw) { cur.push(col3(c) + ' RG ' + (lw || 0.5) + ' w ' + f2(x1) + ' ' + f2(H - top) + ' m ' + f2(x2) + ' ' + f2(H - top) + ' l S\n'); },
        text: function (x, base, s, sz, bold, c, tc) { if (s === '') return; cur.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + sz.toFixed(2) + ' Tf ' + (tc || 0) + ' Tc ' + col3(c) + ' rg ' + f2(x) + ' ' + f2(H - base) + ' Td ' + pdfStr(s) + ' Tj ET\n'); },
        circle: function (cx, top, r, c) { var k = r * 0.5523, cy = H - top; cur.push(col3(c) + ' rg ' + f2(cx + r) + ' ' + f2(cy) + ' m ' + f2(cx + r) + ' ' + f2(cy + k) + ' ' + f2(cx + k) + ' ' + f2(cy + r) + ' ' + f2(cx) + ' ' + f2(cy + r) + ' c ' + f2(cx - k) + ' ' + f2(cy + r) + ' ' + f2(cx - r) + ' ' + f2(cy + k) + ' ' + f2(cx - r) + ' ' + f2(cy) + ' c ' + f2(cx - r) + ' ' + f2(cy - k) + ' ' + f2(cx - k) + ' ' + f2(cy - r) + ' ' + f2(cx) + ' ' + f2(cy - r) + ' c ' + f2(cx + k) + ' ' + f2(cy - r) + ' ' + f2(cx + r) + ' ' + f2(cy - k) + ' ' + f2(cx + r) + ' ' + f2(cy) + ' c f\n'); },
        image: function (idx, x, top, w, h) { if (idx >= 0) cur.push('q ' + f2(w) + ' 0 0 ' + f2(h) + ' ' + f2(x) + ' ' + f2(H - top - h) + ' cm /Im' + (idx + 1) + ' Do Q\n'); },
        clip: function (path, fn) { cur.push('q ' + path + 'W n\n'); fn(); cur.push('Q\n'); },
        grad: function (x, top, w, h, stops, vertical, path) { // a gradient from stops [[colour, ...]] drawn as thin strips inside a clip
          var n = Math.max(8, Math.min(150, Math.ceil((vertical ? h : w) / 1.6))), seg = (vertical ? h : w) / n;
          C.clip(path || (f2(x) + ' ' + f2(H - top - h) + ' ' + f2(w) + ' ' + f2(h) + ' re '), function () {
            for (var i = 0; i < n; i++) {
              var t = (i + 0.5) / n, k = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1))), lt = t * (stops.length - 1) - k, c = mixCols(stops[k], stops[k + 1], lt);
              if (vertical) C.rect(x, top + i * seg - 0.3, w, seg + 1.3, c); else C.rect(x + i * seg - 0.3, top, seg + 1.3, h, c);
            }
          });
        }
      };
      function chip(x, top, s, fill, stroke, tc, bold) { // a pill like the filter chips of the page; returns its width
        var w = textW(s, 7.4, bold !== false) + 15;
        C.rrect(x, top, w, 15, 7.5, fill, stroke, 0.6);
        C.text(x + 7.5, top + 10.3, s, 7.4, bold !== false, tc);
        return w;
      }
      var runTitle = title, heads = 0;
      function newPage(first) {
        cur = [];
        pages.push(cur);
        C.rect(0, 0, W, H, BG);
        if (first) {
          C.grad(0, 0, W, 64, [mixWhite(pc, 0.17), mixWhite(pc2, 0.07), WHITE], false);
          C.rect(0, 64, W, 3.2, RED);
          C.image(logoIdx, M, 8, 48, 48);
          C.text(M + 58, 39, 'Mittal Group', 18, true, pc);
          if (doc.live) { var lw = textW(norm(doc.live), 7.8, false) + 28; C.rrect(W - M - lw, 22, lw, 21, 10.5, mixWhite(GREEN, 0.12), mixWhite(GREEN, 0.45), 0.7); C.circle(W - M - lw + 11, 32.5, 3.2, GREEN); C.text(W - M - lw + 19, 35.6, norm(doc.live), 7.8, false, INK); }
          // the title of the page: a bar of the page colour, the name, a pill with the kind of download
          C.grad(M, 82, 5, 38, [pc, pc2], true, rr(M, 82, 5, 38, 2.5));
          C.text(M + 15, 108, norm(doc.page), 25, true, pc);
          var tw = textW(norm(doc.page), 25, true), kind = doc.kind.toUpperCase(), kw = textW(kind, 7.6, true) + 18;
          C.grad(M + 15 + tw + 12, 92, kw, 16, [pc, pc2], false, rr(M + 15 + tw + 12, 92, kw, 16, 8));
          C.text(M + 15 + tw + 21, 103, kind, 7.6, true, WHITE, 0.4);
          C.text(W - M - textW('Downloaded ' + doc.downloaded, 7.8, false), 104, 'Downloaded ' + doc.downloaded, 7.8, false, GRAY);
          y = 126;
          if (doc.desc) wrapText(norm(doc.desc), avail - 15, 8.4, false, 2).forEach(function (ln) { C.text(M + 15, y + 6, ln, 8.4, false, GRAY); y += 11; });
          y += 4;
          // the filters as chips
          C.text(M, y + 10, 'FILTERS', 6.6, true, GRAY, 0.5);
          var x = M + 44, top = y;
          var list = doc.filters.length ? doc.filters : ['No filter set (everything)'];
          list.concat(doc.chips).forEach(function (f, i) {
            var s = norm(f), w = textW(s, 7.4, true) + 15;
            if (x + w > W - M) { x = M + 44; top += 19; }
            chip(x, top, s, i < list.length ? mixWhite(pc, 0.12) : mixWhite(pc2, 0.16), mixWhite(pc, 0.4), pc);
            x += w + 5;
          });
          y = top + 28;
        } else {
          C.grad(0, 0, W, 30, [mixWhite(pc, 0.15), WHITE], false);
          C.rect(0, 30, W, 2.2, RED);
          C.image(logoIdx, M, 5, 21, 21);
          C.text(M + 27, 20, 'Mittal Group', 10, true, pc);
          C.text(W - M - textW(norm(runTitle), 8.4, true), 20, norm(runTitle), 8.4, true, GRAY);
          y = 44;
        }
      }
      function ensure(h) { if (y + h > bottom) newPage(false); }
      // the whole-dashboard PDF: a bar in the colour of the page starts every page of the dashboard on a new sheet (the first one follows the title of the file)
      function pagehead(b) {
        runTitle = title + ' · ' + b.title;
        if (heads++ > 0) newPage(false); else ensure(60);
        var ac = b.accent || pc, ac2 = b.accent2 || ac, hh = 30;
        C.grad(M, y, avail, hh, [ac, ac2], false, rr(M, y, avail, hh, 8));
        C.text(M + 14, y + 20.5, norm(b.title), 15, true, WHITE);
        if (b.sub) { var sub = wrapText(norm(b.sub), avail * 0.62, 7.2, false, 1)[0] || ''; C.text(W - M - 14 - textW(sub, 7.2, false), y + 19, sub, 7.2, false, WHITE); }
        y += hh + 12;
      }
      function section(s, accent) {
        ensure(84);   // the heading and the first row of tiles stay together
        y += 4;
        C.rrect(M, y + 1, 9, 9, 2.5, accent || pc);
        C.text(M + 15, y + 9.5, norm(s), 11.5, true, INK);
        y += 20;
      }
      // one row of graph cards (one wide graph, or two narrow ones side by side): the card of the page without its table, the picture of every graph inside
      function chartrow(b) {
        var n = b.cards.length, gap = 10, pad = 8, head = 27, cw = n === 1 && b.cards[0].wide ? avail : (avail - gap) / 2, iw = cw - 2 * pad, rowH = 0;
        b.cards.forEach(function (c) {
          var h = head + pad;
          c.imgs.forEach(function (im, i) { im.sc = Math.min(1, iw / im.pw); h += im.ph * im.sc + (i ? 4 : 0); });
          c.h = h + pad; rowH = Math.max(rowH, c.h);
        });
        ensure(rowH + 12);
        b.cards.forEach(function (c, i) {
          var x = M + i * (cw + gap), ac = c.accent || pc;
          C.rrect(x, y, cw, rowH, 8, WHITE, BORDER, 0.6);
          C.clip(rr(x, y, cw, rowH, 8), function () { C.rect(x, y, cw, 2.8, ac); });
          if (c.badge) { C.rrect(x + 8, y + 8.5, 14, 14, 4, ac, null); C.text(x + 15 - textW(c.badge, 7.6, true) / 2, y + 18.6, c.badge, 7.6, true, WHITE); } else C.rrect(x + 8, y + 10.5, 9, 9, 2.5, ac, null);
          C.text(x + (c.badge ? 29 : 24), y + 19, wrapText(norm(c.title), cw - 40, 10.5, true, 1)[0] || '', 10.5, true, INK);
          var iy = y + head;
          c.imgs.forEach(function (im, k) {
            var w = im.pw * im.sc, h = im.ph * im.sc;
            if (k) iy += 4;
            C.image(im.idx, x + pad + (iw - w) / 2, iy, w, h);
            iy += h;
          });
        });
        y += rowH + 12;
      }
      function tiles(items) {
        var cols = avail > 900 ? 6 : 4, gap = 9, bw = (avail - gap * (cols - 1)) / cols, bh = 54, rowTop = 0;
        items.forEach(function (it, i) {
          var col = i % cols;
          if (col === 0) { ensure(bh + gap); rowTop = y; }
          var x = M + col * (bw + gap), top = rowTop, ac = ICO_COLOR[it.ico] ? hexRgb(ICO_COLOR[it.ico]) : pc;
          if (it.hero) {
            C.grad(x, top, bw, bh, [pc, pc2], false, rr(x, top, bw, bh, 9));
          } else {
            C.grad(x, top, bw, bh, [mixWhite(ac, 0.09), WHITE, WHITE], true, rr(x, top, bw, bh, 9));
            C.rrect(x, top, bw, bh, 9, null, BORDER, 0.6);
            C.clip(rr(x, top, bw, bh, 9), function () { C.rect(x, top, bw, 2.8, ac); });
          }
          var bx = x + bw - 7 - 22, by = top + 8;
          C.rrect(bx, by, 22, 22, 6.5, it.hero ? mixCols(pc, WHITE, 0.25) : mixWhite(ac, 0.2), null);
          var im = imgIndex[it.key];
          if (im !== undefined && im !== null) C.image(im, bx + 4.5, by + 4.5, 13, 13);
          wrapText(norm(it.label), bw - 14 - 28, 7.2, false, 2).forEach(function (ln, k) { C.text(x + 7, top + 16 + k * 8.6, ln, 7.2, false, it.hero ? mixCols(WHITE, pc, 0.1) : GRAY); });
          var val = norm(it.value), vs = 15;
          while (vs > 8 && textW(val, vs, true) > bw - 14) vs -= 1;
          C.text(x + 7, top + bh - 9, val, vs, true, it.hero ? WHITE : INK);
          if (col === cols - 1 || i === items.length - 1) y = rowTop + bh + gap;
        });
      }
      function table(t) {
        var X0 = t.x === undefined ? M : t.x, AV = t.w || avail, ci = colInfo(t, size), w = fitCols(ci, AV), tw = 0, lh = size * 1.28, pad = 3, n = t.head.length, xs = [], ac = t.accent || pc;
        w.forEach(function (x) { xs.push(X0 + tw); tw += x; });
        function measure(row, bold, maxLines, up) { // a cell may span several columns (the Total row)
          var cs = [], c0 = 0, mx = 1;
          row.forEach(function (x) {
            var txt = typeof x === 'object' ? x.t : x, span = typeof x === 'object' ? x.s : 1, c1 = Math.min(n - 1, c0 + span - 1), ww = 0;
            for (var c = c0; c <= c1; c++) ww += w[c];
            var s = norm(txt), ls = wrapText(up ? s.toUpperCase() : s, Math.max(8, ww - 2 * pad), size, bold, maxLines);
            mx = Math.max(mx, ls.length);
            cs.push({ c0: c0, c1: c1, w: ww, ls: ls });
            c0 = c1 + 1;
          });
          return { cs: cs, h: mx * lh + 2 * pad - 1 };
        }
        var segTop = 0;
        function paint(m, kind, odd) {
          var top = y, bold = kind !== 'body';
          if (kind === 'head') C.rect(X0, top, tw, m.h, mixWhite(pc, 0.15));
          else if (kind === 'foot') C.rect(X0, top, tw, m.h, mixWhite(pc, 0.12));
          else C.rect(X0, top, tw, m.h, odd ? [0.968, 0.972, 0.98] : WHITE);
          m.cs.forEach(function (k) {
            k.ls.forEach(function (ln, i) {
              var tx = k.c0 === k.c1 && ci.num[k.c0] ? xs[k.c0] + k.w - pad - textW(ln, size, bold) : xs[k.c0] + pad;
              C.text(tx, top + pad + size * 0.9 + i * lh, ln, size, bold, kind === 'head' ? [0.27, 0.28, 0.32] : INK, kind === 'head' ? 0.2 : 0);
            });
          });
          if (kind === 'head') C.line(X0, X0 + tw, top + m.h, mixWhite(pc, 0.62), 1.1); else C.line(X0, X0 + tw, top + m.h, [0.9, 0.91, 0.93], 0.4);
          y += m.h;
        }
        function closeSeg() { if (y > segTop) C.outline(X0, segTop, tw, y - segTop, BORDER); }
        var head = measure(t.head, true, 3, true), subLines = t.title && t.sub ? wrapText(norm(t.sub), tw - 30, 8, false, 2) : [], headH = t.title ? 27 + (subLines.length ? subLines.length * 10.5 + 3 : 0) : 0;
        ensure(headH + head.h + 24);
        if (t.title) { // the card heading: a white bar with the colour of the card on top, its number, its name
          C.rrect(X0, y, tw, headH, 8, WHITE, BORDER, 0.6, 0);
          C.clip(rr(X0, y, tw, headH, 8, 0), function () { C.rect(X0, y, tw, 2.8, ac); });
          if (t.badge) {
            C.rrect(X0 + 8, y + 8.5, 14, 14, 4, ac, null);
            C.text(X0 + 15 - textW(t.badge, 7.6, true) / 2, y + 18.6, t.badge, 7.6, true, WHITE);
          } else C.rrect(X0 + 8, y + 10.5, 9, 9, 2.5, ac, null);
          C.text(X0 + (t.badge ? 29 : 24), y + 19, norm(t.title), 10.5, true, INK);
          subLines.forEach(function (ln, i) { C.text(X0 + 24, y + 31 + i * 10.5, ln, 8, false, [0.35, 0.36, 0.4]); });
          y += headH;
        }
        segTop = t.title ? y - headH : y;
        paint(head, 'head');
        function pageBreak() { closeSeg(); newPage(false); segTop = y; paint(head, 'head'); }
        t.rows.forEach(function (r, i) {
          var m = measure(r, false, 3);
          if (y + m.h > bottom) pageBreak();
          paint(m, 'body', i % 2 === 1);
        });
        t.foot.forEach(function (r) {
          var m = measure(r, true, 4);
          if (y + m.h > bottom) pageBreak();
          paint(m, 'foot');
        });
        closeSeg();
        y += t.gap === undefined ? 14 : t.gap;
      }
      // ---- a list of materials drawn like the dashboard (Price Variance, the lists Price going UP / DOWN): the same columns, the arrows of the last moves, the small trend line, the pills,
      // and every material opened under its row with its figures, its graph and its table of PO dates. The page hands over plain data (price_template.html, window.PDF_DETAILS).
      var CRIT = [0.816, 0.231, 0.231], LINKC = [0.055, 0.498, 0.682], BRANDC = [0.11, 0.678, 0.894], S1C = [0.165, 0.471, 0.839], MUTC = [0.54, 0.53, 0.5];
      var PCOL = { grid: [0.88, 0.88, 0.85], muted: MUTC, brand: BRANDC, s1: S1C, crit: CRIT, good: GREEN, ink: INK, ink2: GRAY };
      function tri(x, yc, up, c) { C.polyFill(up ? [[x - 3, yc + 2.2], [x + 3, yc + 2.2], [x, yc - 3.2]] : [[x - 3, yc - 2.2], [x + 3, yc - 2.2], [x, yc + 3.2]], c); }
      function drawChart(ch, x, top, w, h) { // the primitives of a chart in its own units (ch.W x ch.H) drawn into a box
        var sx = w / ch.W, sy = h / ch.H;
        ch.prims.forEach(function (p) {
          var c = PCOL[p.c] || INK;
          if (p.k === 'line') C.poly([[x + p.x1 * sx, top + p.y1 * sy], [x + p.x2 * sx, top + p.y2 * sy]], c, p.w || 0.5, p.dash);
          else if (p.k === 'poly') C.poly(p.pts.map(function (q) { return [x + q[0] * sx, top + q[1] * sy]; }), c, p.w || 1, null);
          else if (p.k === 'dot') { C.circle(x + p.x * sx, top + p.y * sy, p.r + 0.9, WHITE); C.circle(x + p.x * sx, top + p.y * sy, p.r, c); }
          else if (p.k === 'text') {
            var s = norm(p.s), sz = p.sz || 6, tw0 = textW(s, sz, !!p.b), tx = x + p.x * sx;
            if (p.a === 'end') tx -= tw0; else if (p.a === 'middle') tx -= tw0 / 2;
            C.text(tx, top + p.y * sy, s, sz, !!p.b, c);
          }
        });
      }
      function matlist(t) {
        var X0 = M, TW = avail, nW = 26, trW = Math.min(250, TW * 0.3), chW = Math.min(134, TW * 0.17), mW = TW - nW - trW - chW;
        var xM = X0 + nW, xT = xM + mW, xC = xT + trW, R1 = xT + trW - 8, R2 = xC + chW - 8, PADT = 6;
        var ac = t.accent || pc, headPage = -1;
        function pill(x, top, s, kind) { // a small grey pill (supplier changed, doubtful, import); returns its width
          var sz = 6.3, dot = kind === 'sup', w = textW(norm(s), sz, true) + 9 + (dot ? 7 : 0);
          C.rrect(x, top, w, 10.5, 5.2, kind === 'chk' ? [1, 0.93, 0.78] : kind === 'cur' ? mixWhite(pc, 0.2) : [0.9, 0.91, 0.92], null);
          if (dot) C.circle(x + 6, top + 5.3, 1.7, INK);
          C.text(x + 4.5 + (dot ? 7 : 0), top + 7.6, norm(s), sz, true, INK);
          return w;
        }
        function lpPill(xr, top, lp) { // the loss / profit pill, right aligned at xr
          var s = norm(lp.t), w = textW(s, 6.7, true) + 10, k = lp.k;
          C.rrect(xr - w, top, w, 11.5, 5.7, k === 'loss' ? [0.97, 0.86, 0.86] : k === 'profit' ? [0.86, 0.96, 0.86] : [0.93, 0.93, 0.93], null);
          C.text(xr - w + 5, top + 8.2, s, 6.7, true, k === 'loss' ? [0.78, 0.17, 0.17] : k === 'profit' ? [0.05, 0.5, 0.05] : GRAY);
        }
        var heads = (t.head || ['#', 'Material and its last price moves', 'Rate trend', 'Change · loss / profit']).map(function (h) { return norm(h).toUpperCase(); });
        function drawHead() {
          var hl = [wrapText(heads[0], nW - 8, 6.6, true, 1), wrapText(heads[1], mW - 10, 6.6, true, 2), wrapText(heads[2], trW - 14, 6.6, true, 2), wrapText(heads[3], chW - 14, 6.6, true, 3)];
          var h = Math.max(hl[0].length, hl[1].length, hl[2].length, hl[3].length) * 8.2 + 11;
          C.rect(X0, y, TW, h, mixWhite(pc, 0.15));
          [[hl[0], xN(), 'r'], [hl[1], xM + 4, 'l'], [hl[2], R1, 'r'], [hl[3], R2, 'r']].forEach(function (c) {
            c[0].forEach(function (ln, i) { C.text(c[2] === 'r' ? c[1] - textW(ln, 6.6, true) : c[1], y + 9.5 + i * 8.2, ln, 6.6, true, [0.27, 0.28, 0.32], 0.2); });
          });
          C.line(X0, X0 + TW, y + h, mixWhite(pc, 0.62), 1.1);
          y += h;
          headPage = pages.length;
        }
        function xN() { return X0 + nW - 6; }
        function ensureRow(h) {
          if (y + h > bottom) { newPage(false); drawHead(); }
          else if (headPage !== pages.length) drawHead(); // the page changed inside the table of a panel
        }
        // the heading of the card (a white bar with the colour of the card on top)
        var subLines = t.title && t.sub ? wrapText(norm(t.sub), TW - 30, 8, false, 2) : [], headH = t.title ? 27 + (subLines.length ? subLines.length * 10.5 + 3 : 0) : 0;
        ensure(headH + 70);
        if (t.title) {
          C.rrect(X0, y, TW, headH, 8, WHITE, BORDER, 0.6, 0);
          C.clip(rr(X0, y, TW, headH, 8, 0), function () { C.rect(X0, y, TW, 2.8, ac); });
          if (t.badge) { C.rrect(X0 + 8, y + 8.5, 14, 14, 4, ac, null); C.text(X0 + 15 - textW(t.badge, 7.6, true) / 2, y + 18.6, t.badge, 7.6, true, WHITE); } else C.rrect(X0 + 8, y + 10.5, 9, 9, 2.5, ac, null);
          C.text(X0 + (t.badge ? 29 : 24), y + 19, norm(t.title), 10.5, true, INK);
          subLines.forEach(function (ln, i) { C.text(X0 + 24, y + 31 + i * 10.5, ln, 8, false, [0.35, 0.36, 0.4]); });
          y += headH;
        }
        drawHead();
        t.rows.forEach(function (r, i) {
          // measure the row
          var nm = r.moves ? r.moves.length : 0, left = PADT + 11.5 + 10.5 + nm * 9.6 + (r.more ? 9.5 : 0) + PADT;
          var rowH = Math.max(left, PADT + 22 + 3 + 10.5 + 9.5 + PADT, PADT + 10 + 10 + 4 + 11.5 + PADT);
          ensureRow(rowH + 2);
          var top = y;
          C.rect(X0, top, TW, rowH, i % 2 === 1 ? [0.965, 0.968, 0.975] : WHITE);
          C.line(X0, X0 + TW, top + rowH, [0.9, 0.91, 0.93], 0.4);
          C.text(xN() - textW(String(r.n), 7.5, false), top + PADT + 8.5, String(r.n), 7.5, false, INK);
          // the name (a link on the screen: blue with a dotted line), the code and the pills
          var nameS = norm(r.name), nameW = mW - 10;
          while (nameS.length > 4 && textW(nameS, 8.8, true) > nameW) nameS = nameS.slice(0, -1);
          if (nameS !== norm(r.name)) nameS = nameS.slice(0, -1) + '...';
          C.text(xM + 4, top + PADT + 8.6, nameS, 8.8, true, LINKC);
          C.poly([[xM + 4, top + PADT + 10.6], [xM + 4 + textW(nameS, 8.8, true), top + PADT + 10.6]], mixWhite(LINKC, 0.55), 0.5, [0.7, 1.3]);
          var sub = norm(r.sub), sx0 = xM + 4;
          C.text(sx0, top + PADT + 11.5 + 7.6, sub, 7.2, false, GRAY);
          sx0 += textW(sub, 7.2, false) + 6;
          (r.pills || []).forEach(function (p) { sx0 += pill(sx0, top + PADT + 11.5 + 0.3, p.t, p.k) + 4; });
          var my = top + PADT + 11.5 + 10.5;
          (r.moves || []).forEach(function (m, k) {
            var yc = my + k * 9.6 + 5.2;
            tri(xM + 7, yc - 0.3, m.up, m.up ? CRIT : GREEN);
            var ta = norm(m.d), ax = xM + 14 + textW(ta, 7.6, false) + 3.5;
            C.text(xM + 14, yc + 2.4, ta, 7.6, false, INK);
            C.poly([[ax, yc + 0.5], [ax + 7, yc + 0.5]], INK, 0.7, null);
            C.poly([[ax + 4.4, yc - 1.8], [ax + 7.2, yc + 0.5], [ax + 4.4, yc + 2.8]], INK, 0.7, null);
            C.text(ax + 11, yc + 2.4, norm(m.b), 7.6, true, INK);
          });
          if (r.more) C.text(xM + 4, my + nm * 9.6 + 7, norm(r.more), 6.8, false, GRAY);
          // the rate trend: the small line, the latest rate and its date, the reference
          var sp = r.spark, spw = 72, sph = 20, spx = R1 - spw, spy = top + PADT, sxk = spw / sp.w, syk = sph / sp.h, col = sp.up ? CRIT : GREEN;
          C.poly([[spx + 2 * sxk, spy + sp.ref * syk], [spx + (sp.w - 2) * sxk, spy + sp.ref * syk]], MUTC, 0.6, [2.4, 2.4]);
          C.poly(sp.pts.map(function (q) { return [spx + q[0] * sxk, spy + q[1] * syk]; }), col, 1.3, null);
          C.circle(spx + sp.last[0] * sxk, spy + sp.last[1] * syk, 2, col);
          var by = spy + sph + 3 + 8.5, dt = norm(r.lastDay), pr = norm(r.lastRate);
          C.text(R1 - textW(dt, 7, false), by, dt, 7, false, GRAY);
          C.text(R1 - textW(dt, 7, false) - 4 - textW(pr, 9, true), by, pr, 9, true, INK);
          var wz = norm(r.was);
          C.text(R1 - textW(wz, 6.9, false), by + 9.5, wz, 6.9, false, GRAY);
          // the change and the loss / profit
          var cc = r.up ? CRIT : GREEN, c1 = norm(r.chg), c2 = norm(r.pct);
          C.text(R2 - textW(c1, 9, true), top + PADT + 9, c1, 9, true, cc);
          C.text(R2 - textW(c2, 9, true), top + PADT + 19.5, c2, 9, true, cc);
          if (r.lp) lpPill(R2, top + PADT + 24.5, r.lp);
          y += rowH;
          if (r.panel) panel(r.panel);
        });
        // the total
        var tl = t.foot;
        if (tl) {
          ensureRow(20);
          C.rect(X0, y, TW, 17, mixWhite(pc, 0.12));
          C.text(xM + 4, y + 11.6, norm(tl.t), 7.8, true, INK);
          if (tl.lp) lpPill(R2, y + 2.8, tl.lp);
          y += 17;
        }
        C.outline(X0, y - 17, TW, 17, BORDER);
        y += 14;

        function panel(p) { // one material opened under its row
          var px = xM, pw = TW - nW - 6, ip = 9, iw = pw - 2 * ip;
          var n = p.stats.length, gap = 5, sbW = (iw - gap * (n - 1)) / n;
          var sl = p.stats.map(function (s) { return { v: wrapText(norm(s.v), sbW - 8, 7.4, true, 2), l: wrapText(norm(s.l), sbW - 8, 5.9, false, 2), k: s.k }; });
          var vN = Math.max.apply(null, sl.map(function (s) { return s.v.length; })), lN = Math.max.apply(null, sl.map(function (s) { return s.l.length; }));
          var sbH = 6 + vN * 8.6 + 2 + lN * 7.2 + 5, sumL = wrapText(norm(p.sum), iw, 7, false, 3), chH = p.chart ? 132 : 0;
          var boxH = 7 + 11 + 9.5 + 7 + sbH + 6 + sumL.length * 8.8 + 4 + (p.chart ? 12 + chH + 4 : 0) + 6;
          ensureRow(boxH + 8);
          y += 4;
          var top = y;
          C.rrect(px, top, pw, boxH, 6, mixWhite(pc, 0.07), mixWhite(pc, 0.5), 0.7);
          C.clip(rr(px, top, pw, boxH, 6), function () { C.rect(px, top, 3.2, boxH, pc); });
          var cx = px + ip + 2, yy = top + 7;
          C.text(cx, yy + 9, norm(p.title), 9, true, INK);
          C.text(cx, yy + 19.5, norm(p.sub), 7, false, GRAY);
          yy += 26;
          sl.forEach(function (s, i) {
            var bx = cx + i * (sbW + gap) - 2 + (i ? 0 : 0);
            C.rrect(bx, yy, sbW, sbH, 4, WHITE, BORDER, 0.5);
            var vc = s.k === 'up' || s.k === 'loss' ? CRIT : s.k === 'dn' || s.k === 'profit' ? GREEN : INK;
            s.v.forEach(function (ln, j) { C.text(bx + 4, yy + 6 + 6.6 + j * 8.6, ln, 7.4, true, vc); });
            s.l.forEach(function (ln, j) { C.text(bx + 4, yy + 6 + vN * 8.6 + 2 + 5.4 + j * 7.2, ln, 5.9, false, GRAY); });
          });
          yy += sbH + 6;
          sumL.forEach(function (ln, j) { C.text(cx, yy + 6.5 + j * 8.8, ln, 7, false, GRAY); });
          yy += sumL.length * 8.8 + 4;
          if (p.chart) {
            var lx = cx;
            [['First PO', S1C], ['Rate rose', CRIT], ['Rate fell', GREEN], ['No change', MUTC]].forEach(function (g) { C.circle(lx + 2.5, yy + 5, 2.4, g[1]); C.text(lx + 8, yy + 7.4, g[0], 6.4, false, GRAY); lx += 14 + textW(g[0], 6.4, false) + 8; });
            yy += 12;
            drawChart(p.chart, cx - 2, yy, iw, chH);
          }
          y = top + boxH;
          // the PO dates as a table of the same width under the box
          y += 3;
          if (p.table) table(Object.assign({}, p.table, { x: px, w: pw, title: '', sub: '' }));
        }
      }
      newPage(true);
      doc.blocks.forEach(function (b, bi) {
        if (b.type === 'pagehead') pagehead(b);
        else if (b.type === 'chartrow') chartrow(b);
        else if (b.type === 'section') section(b.title, b.accent);
        else if (b.type === 'tiles') tiles(b.items);
        else if (b.type === 'table') table(b);
        else if (b.type === 'matlist') matlist(b);
      });
      var total = pages.length, st = stampNow().text;
      pages.forEach(function (p, i) {
        cur = p;
        C.line(M, W - M, H - 24, [0.82, 0.83, 0.86], 0.5);
        C.text(M, H - 13, norm('Mittal Group · ' + title + ' · ' + st), 7, false, GRAY);
        var pn = 'Page ' + (i + 1) + ' of ' + total;
        C.text(W - M - textW(pn, 7, false), H - 13, pn, 7, false, GRAY);
      });
      return assemble(pages, W, H);
    }

    // objects: 1 catalog, 2 pages, 3 and 4 fonts, 5 info, then 2 per image (soft mask, image), then a page and its content for every page
    function assemble(pages, W, H) {
      var total = pages.length, nImg = IM.length, pageBase = 6 + 2 * nImg, count = pageBase - 1 + 2 * total;
      var parts = [], len = 0, offs = [];
      function put(x) { var u = typeof x === 'string' ? toU8(x) : x; parts.push(u); len += u.length; }
      function obj(n, body) { offs[n] = len; put(n + ' 0 obj\n' + body + '\nendobj\n'); }
      function stream(n, dict, data, z) { offs[n] = len; put(n + ' 0 obj\n<< ' + dict + ' /Length ' + data.length + (z ? ' /Filter /FlateDecode' : '') + ' >>\nstream\n'); put(data); put('\nendstream\nendobj\n'); }
      var chain = Promise.resolve(), pc2 = [], im2 = [];
      pages.forEach(function (p, i) { chain = chain.then(function () { var raw = toU8(p.join('')); return deflate(raw).then(function (z) { pc2[i] = z ? { d: z, z: 1 } : { d: raw, z: 0 }; }); }); });
      IM.forEach(function (im, i) {
        chain = chain.then(function () {
          var rgb = new Uint8Array(im.w * im.h * 3), al = new Uint8Array(im.w * im.h);
          for (var k = 0, j = 0, a = 0; k < im.data.length; k += 4) { rgb[j++] = im.data[k]; rgb[j++] = im.data[k + 1]; rgb[j++] = im.data[k + 2]; al[a++] = im.data[k + 3]; }
          return Promise.all([deflate(rgb), deflate(al)]).then(function (z) { im2[i] = { rgb: z[0] || rgb, rz: !!z[0], al: z[1] || al, az: !!z[1] }; });
        });
      });
      return chain.then(function () {
        put('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
        obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
        obj(2, '<< /Type /Pages /Kids [' + pages.map(function (p, i) { return (pageBase + 2 * i) + ' 0 R'; }).join(' ') + '] /Count ' + total + ' >>');
        obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
        obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
        obj(5, '<< /Title ' + pdfStr(norm(title)) + ' /Producer (Mittal Group dashboard) >>');
        IM.forEach(function (im, i) {
          var sm = 6 + 2 * i, io = sm + 1;
          stream(sm, '/Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceGray /BitsPerComponent 8', im2[i].al, im2[i].az);
          stream(io, '/Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask ' + sm + ' 0 R', im2[i].rgb, im2[i].rz);
        });
        var xo = IM.map(function (im, i) { return '/Im' + (i + 1) + ' ' + (7 + 2 * i) + ' 0 R'; }).join(' ');
        pages.forEach(function (p, i) {
          var pn = pageBase + 2 * i, cn = pn + 1;
          obj(pn, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W.toFixed(2) + ' ' + H.toFixed(2) + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> ' + (xo ? '/XObject << ' + xo + ' >> ' : '') + '>> /Contents ' + cn + ' 0 R >>');
          stream(cn, '', pc2[i].d, pc2[i].z);
        });
        var xr = len;
        put('xref\n0 ' + (count + 1) + '\n0000000000 65535 f \n');
        for (var n = 1; n <= count; n++) put(('0000000000' + offs[n]).slice(-10) + ' 00000 n \n');
        put('trailer\n<< /Size ' + (count + 1) + ' /Root 1 0 R /Info 5 0 R >>\nstartxref\n' + xr + '\n%%EOF');
        return new Blob(parts, { type: 'application/pdf' });
      });
    }
  }
  function saveBlob(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  function detailCards() { return [].filter.call(document.querySelectorAll('.card[data-detail], .card.tablecard'), function (c) { return !c.closest('[hidden]'); }); }
  function summaryCards() { return [].filter.call(document.querySelectorAll('.wrap .card'), function (c) { return !c.matches('[data-detail], .tablecard, .sumcard') && !c.closest('[hidden]') && mainTables(c).length; }); }
  function sequence(items, fn) { return items.reduce(function (p, it) { return p.then(function () { return fn(it); }); }, Promise.resolve()); }
  function buildSummary() { // -> Promise of a doc
    if (location.pathname === '/summary') { // the cards of the Summary: the name of the page and its figures
      var blocks = [];
      [].forEach.call(document.querySelectorAll('.sumcard'), function (c) {
        var items = tileItems(c);
        if (items.length) { blocks.push({ type: 'section', title: cardTitle(c), accent: cssRgb(getComputedStyle(c).getPropertyValue('--cc'), null) }); blocks.push({ type: 'tiles', items: items }); }
      });
      var d = docInfo('summary');
      d.blocks = blocks;
      return Promise.resolve(d);
    }
    var all = [], items = tileItems();
    if (items.length) all.push({ type: 'tiles', items: items });
    return sequence(summaryCards(), function (card) {
      return openAll(card, 20000).then(function (restore) {
        all = all.concat(cardBlocks(card));
        restore();
      });
    }).then(function () { var d = docInfo('summary'); d.blocks = all; return d; });
  }
  function buildDetails() { // -> Promise of a doc
    var all = [], rows = 0;
    return sequence(detailCards(), function (card) {
      return openAll(card, 120000).then(function (restore) {
        var bl = cardBlocks(card);
        restore();
        bl.forEach(function (b) { rows += b.rows.length; all.push(b); });
      });
    }).then(function () { var d = docInfo('details', ['Rows: ' + rows.toLocaleString('en-IN')]); d.blocks = all; return d; });
  }
  // ---------------------------------------------------------------- the whole dashboard in one PDF
  // (user, 5-Nov-2026: "Download ho to pura dashboard hi download ho, Summary ke sath, PDF me"): the Summary first, then every page of the menu with its tiles, its summary tables
  // and (the full version) its lists. Every page is loaded in a hidden frame with its own default filters, and the frame's own ui.js writes its blocks (window.__dashPdf).
  var WHOLE = [['Summary', '/summary'], ['Store Issue', '/issue'], ['Capital Issue', '/asset'], ['Store Stock', '/stock'], ['Pending PR', '/'], ['Pending Purchase Orders', '/po'],
    ['PO Approval Pending', '/po-approval'], ['Pending Invoice Entry', '/invoice'], ['Purchase', '/purchase'], ['Price Variance', '/price'], ['Payment Ageing', '/ageing']];
  function framePage(path) { // -> Promise of {win, frame} once the page has its data (the live line says "updated hh:mm")
    return new Promise(function (resolve, reject) {
      var f = document.createElement('iframe'), t0 = Date.now(), done = false;
      f.setAttribute('aria-hidden', 'true');
      f.tabIndex = -1;
      f.style.cssText = 'position:fixed;left:-20000px;top:0;width:1400px;height:900px;border:0;opacity:0;pointer-events:none';
      var fail = function (msg) { if (!done) { done = true; f.remove(); reject(new Error(msg)); } };
      f.addEventListener('load', function () {
        (function tick() {
          if (done) return;
          try {
            var d = f.contentDocument, w = f.contentWindow, live = d && d.getElementById('liveTxt'), txt = live ? live.textContent : '';
            if (w.__dashPdf && /updated \d{1,2}:\d{2}/.test(txt)) { done = true; try { w.document.documentElement.dataset.theme = 'light'; } catch (e) { /* stays as it is */ } setTimeout(function () { resolve({ win: w, frame: f }); }, 1800); return; }
          } catch (e) { /* the frame is not ready yet */ }
          if (Date.now() - t0 > 150000) return fail('The page did not load in time.');
          setTimeout(tick, 500);
        })();
      });
      f.src = path + (path.indexOf('?') < 0 ? '?' : '&') + 'embed=1';
      document.body.appendChild(f);
    });
  }
  // A graph as a picture: the element is copied with every computed style into an SVG (foreignObject), drawn on a canvas at twice the size and kept as RGBA for the PDF
  // (the graphs are made of HTML bars, SVG lines and legends; a picture is the only way to show them as on the screen). null when the browser refuses.
  function copyStyles(src, dst) {
    var cs = getComputedStyle(src), st = '';
    for (var i = 0; i < cs.length; i++) { var p = cs[i]; if (p.indexOf('animation') === 0 || p.indexOf('transition') === 0) continue; st += p + ':' + cs.getPropertyValue(p) + ';'; }
    dst.setAttribute('style', st + 'animation:none;transition:none;');   // a bar that grows when it appears must be drawn full grown
    for (var j = 0; j < src.children.length; j++) if (dst.children[j]) copyStyles(src.children[j], dst.children[j]);
  }
  function snap(el, scale) { // -> Promise of {w, h, pw, ph, data} (pixels, css pixels, RGBA) or null
    var r = el.getBoundingClientRect(), w = Math.ceil(r.width), h = Math.ceil(r.height);
    if (w < 20 || h < 20) return Promise.resolve(null);
    var clone = el.cloneNode(true);
    copyStyles(el, clone);
    clone.style.margin = '0'; clone.style.width = w + 'px'; clone.style.height = h + 'px'; clone.style.boxSizing = 'border-box'; clone.style.position = 'static'; clone.style.transform = 'none';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><foreignObject x="0" y="0" width="' + w + '" height="' + h + '">' + new XMLSerializer().serializeToString(clone) + '</foreignObject></svg>';
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = Math.round(w * scale); c.height = Math.round(h * scale);
          var x = c.getContext('2d');
          x.scale(scale, scale); x.drawImage(img, 0, 0, w, h);
          res({ w: c.width, h: c.height, pw: w, ph: h, data: x.getImageData(0, 0, c.width, c.height).data });
        } catch (e) { res(null); }
      };
      img.onerror = function () { res(null); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  var CHART_SEL = '[data-chart], .uichart:not([hidden]), .ioChart';
  function chartCards() { // -> Promise of [{title, badge, accent, imgs, wide}]: one entry per card of the page that holds a graph, in the order of the page
    var cards = [].filter.call(document.querySelectorAll('.wrap .card'), function (c) { return !c.closest('[hidden]') && c.querySelector(CHART_SEL); });
    var folded = cards.filter(function (c) { return c.classList.contains('folded'); }), out = [];
    folded.forEach(function (c) { c.classList.remove('folded'); });
    var t0 = Date.now();
    // the in / out graphs of Store Stock stay empty until the goods movements are read (about half a minute after the page opens): wait for them, at most a minute
    function movesWait() { var empty = [].some.call(document.querySelectorAll('.ioChart'), function (e) { return !e.children.length && !e.closest('[hidden]'); }); return empty && Date.now() - t0 < 60000 ? new Promise(function (r) { setTimeout(r, 1000); }).then(movesWait) : null; }
    return new Promise(function (r) { setTimeout(r, 700); }).then(movesWait).then(function () {   // the graphs draw again at their real width
      return sequence(cards, function (card) {
        var hosts = [].filter.call(card.querySelectorAll(CHART_SEL), function (e) { var b = e.getBoundingClientRect(); return b.width > 40 && b.height > 30; });
        if (!hosts.length) return null;
        var sels = [], imgs = [];
        hosts.forEach(function (h) { [].forEach.call(h.querySelectorAll('.sel'), function (e) { e.classList.remove('sel'); sels.push(e); }); });   // the chosen bar is not marked in the picture
        return sequence(hosts, function (h) { return snap(h, 2).then(function (im) { if (im) imgs.push(im); }); }).then(function () {
          sels.forEach(function (e) { e.classList.add('sel'); });
          if (!imgs.length) return;
          var on = card.querySelector('.sc [aria-pressed="true"]'), badge = card.querySelector('.sec-badge');
          out.push({ title: cardTitle(card) + (on ? ' · ' + on.textContent.trim() : ''), badge: badge ? badge.textContent.trim() : '', accent: cssRgb(getComputedStyle(card).getPropertyValue('--cc'), null), imgs: imgs, wide: Math.max.apply(null, imgs.map(function (i) { return i.pw; })) >= 800 });
        });
      });
    }).then(function () { folded.forEach(function (c) { c.classList.add('folded'); }); return out; });
  }
  function buildShort() { // the main things of the page: its tiles and its graphs (a page without a graph gets the first rows of its first table) -> Promise of a doc
    var d = docInfo('short'), blocks = [], items = tileItems();
    if (items.length) blocks.push({ type: 'tiles', items: items });
    return chartCards().then(function (cards) {
      var rows = [], pend = null;
      cards.forEach(function (c) { // a wide graph has a row of its own, narrow ones go two by two
        if (c.wide) { if (pend) { rows.push([pend]); pend = null; } rows.push([c]); } else if (pend) { rows.push([pend, c]); pend = null; } else pend = c;
      });
      if (pend) rows.push([pend]);
      rows.forEach(function (r) { blocks.push({ type: 'chartrow', cards: r }); });
      if (typeof window.PDF_DETAILS === 'function') { // Price Variance: the lists Price going UP / DOWN as on the screen, the first 20 materials of each with the graph of every material (user, 5-Nov-2026)
        [].forEach.call(document.querySelectorAll('.wrap .card'), function (card) {
          var extra = window.PDF_DETAILS(card, 20);
          if (!extra || !extra.length) return;
          var badge = card.querySelector('.sec-badge'), cc = cssRgb(getComputedStyle(card).getPropertyValue('--cc'), null);
          extra.forEach(function (b, i) { b.accent = cc; b.badge = i === 0 && badge ? badge.textContent.trim() : ''; b.title = i === 0 ? cardTitle(card) + ' · the first 20 materials' : ''; blocks.push(b); });
        });
      }
      if (!cards.length) {
        var first = summaryCards()[0], tb = first && cardBlocks(first).filter(function (b) { return b.type === 'table'; })[0];
        if (tb) { tb.rows = tb.rows.slice(0, 10); tb.foot = []; tb.title = tb.title + ' · the first 10'; blocks.push(tb); }
      }
      d.blocks = blocks;
      return d;
    });
  }
  function buildWhole(mode, progress) { // mode: 'short' = tiles and graphs of every page, 'all' = tiles, summary tables and lists, 'figures' = tiles and summary tables -> Promise of a doc
    var withLists = mode === 'all', blocks = [], names = [], here = location.pathname;
    return sequence(WHOLE, function (s, i) {
      var idx = WHOLE.indexOf(s);
      progress('Preparing ' + (idx + 1) + '/' + WHOLE.length + ' · ' + s[0] + '…');
      var local = s[1] === '/summary' && here === '/summary';   // the Summary you are looking at keeps its own filters
      var get = local ? Promise.resolve({ win: window, frame: null }) : framePage(s[1]);
      return get.then(function (h) {
        var api = h.win.__dashPdf;
        return (mode === 'short' && s[1] !== '/summary' ? api.short() : api.summary()).then(function (sd) {
          blocks.push({ type: 'pagehead', title: s[0], sub: sd.filters.join('  ·  '), accent: sd.pc, accent2: sd.pc2 });
          sd.blocks.forEach(function (b) { blocks.push(b); });
          names.push(s[0]);
          if (!withLists || s[1] === '/summary') return;
          return api.details().then(function (dd) { dd.blocks.forEach(function (b) { blocks.push(b); }); });
        }).then(function () { if (h.frame) h.frame.remove(); }, function (e) { if (h.frame) h.frame.remove(); throw e; });
      }).catch(function (e) { // a page that could not be read is named in the file, the others still come
        blocks.push({ type: 'pagehead', title: s[0], sub: '', accent: null });
        blocks.push({ type: 'section', title: 'This page could not be read: ' + (e && e.message ? e.message : 'unknown error'), accent: null });
      });
    }).then(function () {
      var d = docInfo(mode === 'short' ? 'all pages' : withLists ? 'all pages · lists' : 'all pages · figures');
      d.page = 'Whole dashboard';
      d.desc = 'The Summary first, then every page of the menu in its order: ' + names.join(', ') + '. ' + (mode === 'short' ? 'Every page shows its main figures (the tiles) and its graphs; the long tables and lists are not in this file (the Download menu of a page has Summary and Details)' : withLists ? 'Every page shows its tiles, its summary tables and its lists' : 'Every page shows its tiles and its summary tables') + ', with the default filters of that page (the filters are written in the bar of the page).';
      d.filters = ['Every page with its own default filters'];
      d.blocks = blocks;
      return d;
    });
  }
  window.__dashPdf = { summary: buildSummary, details: buildDetails, short: buildShort };   // read by the whole-dashboard download of another page (through a hidden frame)

  function downloadSetup() {
    var tools = document.querySelector('.top .tools');
    if (!tools || embedded || document.getElementById('dlBtn')) return;
    var isSummary = location.pathname === '/summary', slugName = PAGE_SLUG || (isSummary ? 'summary' : '');
    if (!slugName) return;
    var wrap = document.createElement('div');
    wrap.className = 'dlwrap';
    wrap.innerHTML = '<button type="button" class="btn dlbtn" id="dlBtn" aria-haspopup="true" aria-expanded="false" title="Download this page as a PDF file">Download</button>'
      + '<div class="dlmenu" id="dlMenu" role="menu" hidden>'
      + '<button type="button" role="menuitem" data-dl="summary"><b>Summary</b><span>' + (isSummary ? 'The figures of every page' : 'The tiles and every summary table') + ' · PDF</span></button>'
      + (isSummary ? '' : '<button type="button" role="menuitem" data-dl="details"><b>Details</b><span>Every row of the list under the filters set now · PDF</span></button>')
      + '<button type="button" role="menuitem" data-dl="short"><b>Whole dashboard</b><span>The Summary and the main figures and graphs of every page, in short · PDF (1–2 minutes)</span></button>'
      + '</div>';
    var refresh = document.getElementById('refresh');
    tools.insertBefore(wrap, refresh ? refresh.nextSibling : tools.firstChild);
    var btn = document.getElementById('dlBtn'), menu = document.getElementById('dlMenu');
    var close = function () { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', function (e) { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    menu.addEventListener('click', function (e) {
      var it = e.target.closest('[data-dl]');
      if (!it || btn.disabled) return;
      var kind = it.getAttribute('data-dl');
      close();
      btn.disabled = true;
      btn.textContent = 'Preparing…';
      var failed = false, whole = kind === 'short' || kind === 'all' || kind === 'figures';
      (whole ? buildWhole(kind, function (t) { btn.textContent = t; }) : kind === 'summary' ? buildSummary() : buildDetails()).then(function (doc) {
        if (!doc.blocks.length) { btn.textContent = 'Nothing to download'; failed = true; return; }
        if (whole) btn.textContent = 'Writing the PDF…';
        return buildPdf(doc).then(function (blob) {
          saveBlob((whole ? (kind === 'figures' ? 'dashboard-figures' : kind === 'all' ? 'dashboard-lists' : 'dashboard') : isSummary ? 'summary' : slugName + '_' + kind) + '_' + stampNow().file + '.pdf', blob);
          btn.textContent = 'Download';
        });
      }).catch(function () { failed = true; btn.textContent = 'Download failed'; }).then(function () {
        btn.disabled = false;
        if (failed) setTimeout(function () { if (!btn.disabled) btn.textContent = 'Download'; }, 2500);
      });
    });
  }

  // ---------------------------------------------------------------- fold the cards: a shorter page
  // The first two cards of a page start open, the others folded (a card with data-keep-open stays open). A click on a heading, or on its arrow, folds or opens the card and the
  // choice is remembered per page. The button in the header folds or opens all of them. Nothing is removed: a folded card keeps its data, its CSV button and its filters.
  var FOLD_OPEN_FIRST = 2;
  function foldKey(i) { return 'spr-fold|' + location.pathname + '|' + i; }
  function foldList() {
    return [].filter.call(document.querySelectorAll('.grid > .card, .card[data-foldable]'), function (c) { return c.querySelector('h2'); });
  }
  function setFold(card, folded, save) {
    card.classList.toggle('folded', folded);
    var b = card.querySelector('.foldbtn');
    if (b) {
      b.setAttribute('aria-expanded', String(!folded));
      b.setAttribute('aria-label', folded ? 'Open this card' : 'Fold this card');
      b.title = folded ? 'Open this card' : 'Fold this card';
    }
    if (save) { try { localStorage.setItem(foldKey(card.getAttribute('data-fold')), folded ? '1' : '0'); } catch (e) {} }
  }
  function foldMaster() {
    var tools = document.querySelector('.top .tools'), all = document.getElementById('foldAll');
    if (!tools || embedded) return;
    if (!all) {
      all = document.createElement('button');
      all.type = 'button';
      all.id = 'foldAll';
      all.className = 'btn densebtn';
      tools.insertBefore(all, tools.querySelector('.densebtn') || tools.querySelector('#themeSeg'));
      all.addEventListener('click', function () {
        var cards = foldList(), anyOpen = cards.some(function (c) { return !c.classList.contains('folded'); });
        cards.forEach(function (c) { setFold(c, anyOpen, true); });
        foldMaster();
      });
    }
    var open = foldList().some(function (c) { return !c.classList.contains('folded'); });
    all.textContent = open ? 'Fold cards' : 'Open cards';
    all.setAttribute('data-open', open ? '1' : '0');
    all.title = open ? 'Fold all the cards (shorter page)' : 'Open all the cards';
  }
  function foldCards() {
    var cards = foldList();
    if (!cards.length) return;
    cards.forEach(function (card, i) {
      if (card.hasAttribute('data-fold')) return;
      var h = card.querySelector('h2'), saved = null;
      try { saved = localStorage.getItem(foldKey(i)); } catch (e) {}
      var keep = card.hasAttribute('data-keep-open') || !!card.closest('[data-keep-open]');
      card.setAttribute('data-fold', String(i));
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'foldbtn';
      h.insertBefore(b, h.firstChild);
      setFold(card, saved === null ? (i >= FOLD_OPEN_FIRST && !keep) : saved === '1', false);
      var flip = function () { setFold(card, !card.classList.contains('folded'), true); foldMaster(); };
      b.addEventListener('click', function (e) { e.stopPropagation(); flip(); });
      h.addEventListener('click', function (e) { if (!e.target.closest('button, a, select, input, label')) flip(); });
    });
    foldMaster();
  }

  // ---------------------------------------------------------------- run, and again after every redraw of the page
  function enhance() { bars(); icons(); charts(); countUps(); csvButtons(); foldCards(); downloadSetup(); }
  var timer = null;
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) { // our own number animation is not a redraw
      var t = muts[i].target;
      if (!(t.closest && t.closest('[data-cu-busy]')) && !(t.parentElement && t.parentElement.closest && t.parentElement.closest('[data-cu-busy]'))) {
        clearTimeout(timer);
        timer = setTimeout(enhance, 90);
        return;
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(enhance, 150); });
  enhance();
})();
