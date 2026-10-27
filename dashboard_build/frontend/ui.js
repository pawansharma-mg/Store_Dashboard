/* Helpers shared by every page (loaded with defer, after the page's own script). Nothing here changes a figure; it only draws.
   - bars behind the value column of the summary tables
   - an icon on every tile, and numbers that count up (or move from the old to the new number when a filter changes)
   - bar and donut charts above the month / day / ageing / plant / category tables (a click on a bar or a slice does what the table row does)
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
  // page -> table container -> chart. col: which column to draw (a header test); rev: the table lists the newest first
  var CHARTS = {
    '/issue': [{ id: 'byMonth', type: 'cols', col: /value/i, rev: true }, { id: 'byDay', type: 'cols', col: /value/i }, { id: 'byDept', type: 'donut', col: /value/i }],
    '/po': [{ id: 'byMonth', type: 'cols', col: /net value/i, rev: true }, { id: 'byDay', type: 'cols', col: /net value/i }, { id: 'byPlant', type: 'donut', col: /net value/i }, { id: 'byType', type: 'donut', col: /net value/i }],
    '/po-approval': [{ id: 'byAge', type: 'cols', col: /^pos$/i }, { id: 'byAppr', type: 'donut', col: /^pos$/i }, { id: 'byPlant', type: 'donut', col: /net value/i }],
    '/invoice': [{ id: 'byAge', type: 'cols', col: /^items$/i }, { id: 'byMonth', type: 'cols', col: /^items$/i, rev: true }, { id: 'byDay', type: 'cols', col: /^items$/i }, { id: 'byDept', type: 'donut', col: /^items$/i }, { id: 'byPlant', type: 'donut', col: /^items$/i }],
    '/purchase': [{ id: 'byMonth', type: 'cols', col: /net value/i, rev: true }, { id: 'byDay', type: 'cols', col: /net value/i }, { id: 'byDept', type: 'donut', col: /net value/i }, { id: 'byPlant', type: 'donut', col: /net value/i }],
    '/asset': [{ id: 'byMonth', type: 'cols', col: /^amount$/i, rev: true }, { id: 'byDay', type: 'cols', col: /^amount$/i }, { id: 'byCo', type: 'donut', col: /^amount$/i }, { id: 'byCls', type: 'donut', col: /^amount$/i }],
    '/stock': [{ id: 'byCat', type: 'donut', col: /value/i }, { id: 'byMtype', type: 'donut', col: /value/i }, { id: 'byType', type: 'donut', col: /total value/i }, { id: 'byPlant', type: 'donut', col: /total value/i }]
  };
  function readTable(box, colTest, rev) {
    var t = box.querySelector('table');
    if (!t || !t.tHead || !t.tBodies[0]) return null;
    var head = t.tHead.rows[0], col = -1;
    for (var c = 0; c < head.cells.length; c++) if (colTest.test(head.cells[c].textContent.trim())) col = c;
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
    return { rows: rows, money: money };
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function short(label) { // "Oct 2026" -> "Oct 26", "01 Oct 2026" -> "1", "0–2 days" stays
    var m = /^(\w{3}) (\d{4})$/.exec(label);
    if (m) return m[1] + ' ' + m[2].slice(2);
    m = /^(\d{1,2}) \w{3,4} \d{4}$/.exec(label);
    return m ? String(parseInt(m[1], 10)) : label;
  }
  function columns(data, width) {
    var rows = data.rows, max = 0, i;
    for (i = 0; i < rows.length; i++) if (rows[i].value > max) max = rows[i].value;
    // what fits: a value above each bar needs about 54 px, a month name about 36 px; with less room the labels are thinned out (the last bar always keeps its name)
    var per = (width || 320) / Math.max(1, rows.length);
    var dense = per < 54, step = per >= 36 ? 1 : per >= 24 ? 2 : per >= 16 ? 3 : 5;
    var h = '<div class="uc-cols">';
    for (i = 0; i < rows.length; i++) {
      var r = rows[i], pct = max > 0 ? Math.max(r.value > 0 ? 3 : 0, r.value / max * 100) : 0;
      var showLab = (rows.length - 1 - i) % step === 0;
      h += '<button type="button" class="uc-col' + (r.sel ? ' sel' : '') + '" data-i="' + i + '" title="' + esc(r.label + ': ' + r.text) + '">' +
        (dense ? '' : '<span class="uc-val">' + esc(r.text) + '</span>') +
        '<span class="uc-bar" style="height:' + pct.toFixed(1) + '%"></span><span class="uc-lab">' + (showLab ? esc(short(r.label)) : '&nbsp;') + '</span></button>';
    }
    return h + '</div>';
  }
  function donut(data) {
    var rows = data.rows.filter(function (r) { return r.value > 0; }).sort(function (a, b) { return b.value - a.value; });
    var total = 0, i;
    for (i = 0; i < rows.length; i++) total += rows[i].value;
    if (!(total > 0)) return null;
    var shown = rows.slice(0, 6), rest = rows.slice(6);
    if (rest.length) shown.push({ label: 'Others (' + rest.length + ')', value: rest.reduce(function (s, r) { return s + r.value; }, 0), text: data.money ? inr(rest.reduce(function (s, r) { return s + r.value; }, 0)) : plain(rest.reduce(function (s, r) { return s + r.value; }, 0)), other: true });
    var R = 44, C = 2 * Math.PI * R, off = 0, segs = '', leg = '';
    data._items = shown;
    for (i = 0; i < shown.length; i++) {
      var s = shown[i], len = s.value / total * C, color = s.other ? OTHER : PALETTE[i % PALETTE.length], pct = (s.value / total * 100);
      var tip = esc(s.label + ': ' + s.text + ' (' + pct.toFixed(1) + '%)');
      segs += '<circle class="uc-seg' + (s.sel ? ' sel' : '') + '" data-i="' + i + '" cx="60" cy="60" r="' + R + '" stroke="' + color + '" stroke-dasharray="' + Math.max(0, len - 1.5).toFixed(2) + ' ' + (C - Math.max(0, len - 1.5)).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '"><title>' + tip + '</title></circle>';
      leg += '<li><button type="button" class="' + (s.sel ? 'sel' : '') + '" data-i="' + i + '" title="' + tip + '"><i style="background:' + color + '"></i><b>' + esc(s.label) + '</b><span>' + esc(s.text) + ' · ' + pct.toFixed(pct < 10 ? 1 : 0) + '%</span></button></li>';
      off += len;
    }
    var center = data.money ? inr(total) : plain(total);
    return '<svg class="uc-svg" viewBox="0 0 120 120" role="img" aria-label="Chart"><circle class="uc-ring" cx="60" cy="60" r="' + R + '"/>' + segs +
      '<text class="uc-center" x="60" y="62">' + esc(center) + '</text><text class="uc-sub" x="60" y="75">total</text></svg><ul class="uc-leg">' + leg + '</ul>';
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
      var inner = c.type === 'cols' ? columns(data, box.clientWidth) : donut(data);
      if (!inner) { if (host) host.hidden = true; continue; }
      if (!host) {
        host = document.createElement('div');
        host.className = 'uichart uichart-' + c.type;
        box.parentNode.insertBefore(host, box);
        box._uc = host;
        // a click on a bar, a slice or a legend line does what the table row does
        host.addEventListener('click', function (e) {
          var el = e.target.closest('[data-i]');
          if (!el || !this._rows) return;
          var item = this._rows[+el.getAttribute('data-i')];
          if (item && item.link) item.link.click();
        });
      }
      host.hidden = false;
      host._rows = c.type === 'cols' ? data.rows : data._items;
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
    [].forEach.call(c.querySelectorAll('.sec-badge,.csvbtn,.opn,.foldbtn'), function (e) { e.remove(); });
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
  function csvButtons() {
    if (!PAGE_SLUG) return;
    var cards = document.querySelectorAll('.card');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i], h = card.querySelector('h2');
      if (card.hasAttribute('data-csv') || !h || !mainTables(card).length) continue;
      card.setAttribute('data-csv', '1');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'csvbtn';
      b.textContent = 'CSV';
      b.title = 'Download this table as a CSV file (opens in Excel)';
      b.addEventListener('click', exportCard.bind(null, card, b));
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
    return { page: pageName(), kind: kind, desc: desc ? desc.textContent.replace(/\s+/g, ' ').trim() : '', live: live ? live.textContent.replace(/\s+/g, ' ').trim() : '', filters: filtersList(), chips: chips || [], downloaded: stampNow().text };
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
          C.text(W - M - textW(norm(title), 8.4, true), 20, norm(title), 8.4, true, GRAY);
          y = 44;
        }
      }
      function ensure(h) { if (y + h > bottom) newPage(false); }
      function section(s, accent) {
        ensure(60);
        y += 4;
        C.rrect(M, y + 1, 9, 9, 2.5, accent || pc);
        C.text(M + 15, y + 9.5, norm(s), 11.5, true, INK);
        y += 20;
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
        var ci = colInfo(t, size), w = fitCols(ci, avail), tw = 0, lh = size * 1.28, pad = 3, n = t.head.length, xs = [], ac = t.accent || pc;
        w.forEach(function (x) { xs.push(M + tw); tw += x; });
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
          if (kind === 'head') C.rect(M, top, tw, m.h, mixWhite(pc, 0.15));
          else if (kind === 'foot') C.rect(M, top, tw, m.h, mixWhite(pc, 0.12));
          else C.rect(M, top, tw, m.h, odd ? [0.968, 0.972, 0.98] : WHITE);
          m.cs.forEach(function (k) {
            k.ls.forEach(function (ln, i) {
              var tx = k.c0 === k.c1 && ci.num[k.c0] ? xs[k.c0] + k.w - pad - textW(ln, size, bold) : xs[k.c0] + pad;
              C.text(tx, top + pad + size * 0.9 + i * lh, ln, size, bold, kind === 'head' ? [0.27, 0.28, 0.32] : INK, kind === 'head' ? 0.2 : 0);
            });
          });
          if (kind === 'head') C.line(M, M + tw, top + m.h, mixWhite(pc, 0.62), 1.1); else C.line(M, M + tw, top + m.h, [0.9, 0.91, 0.93], 0.4);
          y += m.h;
        }
        function closeSeg() { if (y > segTop) C.outline(M, segTop, tw, y - segTop, BORDER); }
        var head = measure(t.head, true, 3, true), headH = t.title ? 27 : 0;
        ensure(headH + head.h + 24);
        if (t.title) { // the card heading: a white bar with the colour of the card on top, its number, its name
          C.rrect(M, y, tw, headH, 8, WHITE, BORDER, 0.6, 0);
          C.clip(rr(M, y, tw, headH, 8, 0), function () { C.rect(M, y, tw, 2.8, ac); });
          if (t.badge) {
            C.rrect(M + 8, y + 8.5, 14, 14, 4, ac, null);
            C.text(M + 15 - textW(t.badge, 7.6, true) / 2, y + 18.6, t.badge, 7.6, true, WHITE);
          } else C.rrect(M + 8, y + 10.5, 9, 9, 2.5, ac, null);
          C.text(M + (t.badge ? 29 : 24), y + 19, norm(t.title), 10.5, true, INK);
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
        y += 14;
      }
      newPage(true);
      doc.blocks.forEach(function (b, bi) {
        if (b.type === 'section') section(b.title, b.accent);
        else if (b.type === 'tiles') tiles(b.items);
        else if (b.type === 'table') table(b);
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
      var failed = false;
      (kind === 'summary' ? buildSummary() : buildDetails()).then(function (doc) {
        if (!doc.blocks.length) { btn.textContent = 'Nothing to download'; failed = true; return; }
        return buildPdf(doc).then(function (blob) {
          saveBlob((isSummary ? 'summary' : slugName + '_' + kind) + '_' + stampNow().file + '.pdf', blob);
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
