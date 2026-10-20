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
    [/top 5|expensive/i, 'trophy'], [/not used/i, 'moon'], [/blocked/i, 'lock'], [/quality/i, 'shield'], [/lines|items/i, 'box'], [/location/i, 'pin'], [/supplier/i, 'truck'],
    [/cost center/i, 'target'], [/quantity to check/i, 'alert'], [/approval/i, 'check'], [/day|oldest|waiting|overdue|older|passed/i, 'clock'],
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
  var PALETTE = ['#1CADE4', '#6C5CE7', '#00B894', '#F59E0B', '#E17055', '#74B9FF', '#A29BFE'];
  var OTHER = '#94A3B8';
  // page -> table container -> chart. col: which column to draw (a header test); rev: the table lists the newest first
  var CHARTS = {
    '/issue': [{ id: 'byMonth', type: 'cols', col: /value/i, rev: true }, { id: 'byDay', type: 'cols', col: /value/i }, { id: 'byDept', type: 'donut', col: /value/i }],
    '/po': [{ id: 'byMonth', type: 'cols', col: /net value/i, rev: true }, { id: 'byDay', type: 'cols', col: /net value/i }, { id: 'byPlant', type: 'donut', col: /net value/i }, { id: 'byType', type: 'donut', col: /net value/i }],
    '/po-approval': [{ id: 'byAge', type: 'cols', col: /^pos$/i }, { id: 'byAppr', type: 'donut', col: /^pos$/i }, { id: 'byPlant', type: 'donut', col: /net value/i }],
    '/stock': [{ id: 'byCat', type: 'donut', col: /value/i }, { id: 'byType', type: 'donut', col: /total value/i }, { id: 'byPlant', type: 'donut', col: /total value/i }]
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
  var PAGE_SLUG = { '/': 'pending-pr', '/issue': 'store-issue', '/po': 'purchase-orders', '/po-approval': 'po-approval', '/stock': 'store-stock' }[location.pathname];
  function slug(t) { return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'table'; }
  function cardTitle(card) {
    var h = card.querySelector('h2');
    if (!h) return 'table';
    var c = h.cloneNode(true);
    [].forEach.call(c.querySelectorAll('.sec-badge,.badge-live,.csvbtn,.opn'), function (e) { e.remove(); });
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
    var t = td.textContent.replace(/\s+/g, ' ').trim();
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
  function openAll(card) { // a list that shows only its first rows is opened to every row first; resolves with a function that puts it back
    var btn = card.querySelector('#seeAll,#tileAll');
    if (!btn || btn.hidden || !/^See all/i.test(btn.textContent)) return Promise.resolve(function () {});
    var n = parseInt(btn.textContent.replace(/[^\d]/g, ''), 10) || 0;
    btn.click();
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function wait() {
        if ((n && rowCount(card) >= n) || Date.now() - t0 > 9000) {
          return resolve(function () {
            var b = card.querySelector('#seeAll,#tileAll');
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
      mainTables(card).forEach(function (t, i) {
        if (i) {
          out.push('');
          var h = t.closest('.tbox') && t.closest('.tbox').previousElementSibling;
          if (h && /^H3$/.test(h.tagName)) out.push(field(h.textContent.trim()));
        } else if (mainTables(card).length > 1) {
          var h0 = t.closest('.tbox') && t.closest('.tbox').previousElementSibling;
          if (h0 && /^H3$/.test(h0.tagName)) out.push(field(h0.textContent.trim()));
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

  // ---------------------------------------------------------------- run, and again after every redraw of the page
  function enhance() { bars(); icons(); charts(); countUps(); csvButtons(); }
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
