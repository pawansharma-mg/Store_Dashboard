/* Small helpers shared by every page (loaded with defer, after the page's own script). Nothing here changes any figure:
   it only draws bars behind the value column of the summary tables, shows a shadow under the header once the page is scrolled,
   adds a back-to-top button, and lets "/" jump to the search box. */
(function () {
  'use strict';

  // header: shadow once the page is scrolled
  var stick = document.querySelector('.stick');
  // back to top
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

  // the open page in the menu, for screen readers
  var on = document.querySelector('.nav a.on');
  if (on) on.setAttribute('aria-current', 'page');

  // "/" jumps to the search box (unless you are typing somewhere)
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

  // bars behind the value column: "₹1.21 Cr", "₹39.27 L", "₹6,000", "1,234" are read back as numbers; the longest bar is the biggest value in that table
  var UNIT = /^₹?\s*(-?[\d,]+(?:\.\d+)?)\s*(Cr|L)?$/;
  function num(text) {
    var m = UNIT.exec(text.trim());
    if (!m) return NaN;
    var v = parseFloat(m[1].replace(/,/g, ''));
    return m[2] === 'Cr' ? v * 1e7 : m[2] === 'L' ? v * 1e5 : v;
  }
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
      var rows = [], vals = [], max = 0;
      for (var r = 0; r < body.rows.length; r++) {
        var cell = body.rows[r].cells[col];
        if (!cell || body.rows[r].cells.length <= col) continue;
        var v = num(cell.textContent);
        rows.push(cell);
        vals.push(v);
        if (v > max) max = v;
      }
      for (var k = 0; k < rows.length; k++) {
        if (max > 0 && vals[k] > 0) {
          rows[k].classList.add('hasbar');
          rows[k].style.setProperty('--w', Math.max(2, vals[k] / max * 100).toFixed(1) + '%');
        } else if (rows[k].classList.contains('hasbar')) {
          rows[k].classList.remove('hasbar');
          rows[k].style.removeProperty('--w');
        }
      }
    }
  }
  // the pages redraw their tables on every filter change; draw the bars again a moment after the last change (only attributes change here, so this cannot loop)
  var timer = null;
  new MutationObserver(function () {
    clearTimeout(timer);
    timer = setTimeout(bars, 90);
  }).observe(document.body, { childList: true, subtree: true });
  bars();
})();
