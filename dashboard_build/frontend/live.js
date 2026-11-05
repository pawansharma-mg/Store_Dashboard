/* Live data for every page: the page asks its view again every 30 seconds (LIVE.every).
   The server answers with the tag (ETag) of the data it holds; the page sends the tag it has, and when nothing changed the server answers
   304 without the data, so a quiet view costs almost nothing and the page is not redrawn (scroll position, open lists and filters stay).
   LIVE.get(url, force) resolves {res, j, same, stamp}: same = no change since the last call, stamp = when the server read SAP (ms). */
(function () {
  var tags = {};
  window.LIVE = {
    every: 30000,
    get: function (url, force) {
      var h = {};
      if (!force && tags[url]) h['If-None-Match'] = tags[url];
      return fetch(url + (force ? (url.indexOf('?') < 0 ? '?' : '&') + 'refresh=1' : ''), { cache: 'no-store', headers: h }).then(function (res) {
        var stamp = +res.headers.get('X-Fetched-At') || 0;
        if (res.status === 304) return { res: res, j: null, same: true, stamp: stamp };
        return res.json().catch(function () { return {}; }).then(function (j) {
          if (res.ok) { var t = res.headers.get('ETag'); if (t) tags[url] = t; }
          return { res: res, j: j, same: false, stamp: stamp || (j && j.fetchedAt) || 0 };
        });
      });
    },
    // forget the tag of a url, so the next call returns the data again (a page that could not use the data it got)
    forget: function (url) { delete tags[url]; }
  };
})();

// Ageing (days) shared by the pages: one set of buckets, one pill, small helpers.
// age = days from a date to the as-of day of the data (D.asofDay, the day the server read SAP).
(function () {
  var EDGES = [7, 15, 30, 60, 90, 180, 365];
  var LABELS = ['0–7 days', '8–15 days', '16–30 days', '31–60 days', '61–90 days', '91–180 days', '181–365 days', 'Over 1 year'];
  function bucket(d) { for (var i = 0; i < EDGES.length; i++) if (d <= EDGES[i]) return i; return EDGES.length; }
  // "123 d" in a coloured pill: green = young, red = old
  function pill(d, tip) {
    if (d === null || d === undefined || isNaN(d)) return '<span title="No date">–</span>';
    d = Math.max(0, Math.round(d));
    return '<span class="agep a' + bucket(d) + '"' + (tip ? ' title="' + String(tip).replace(/"/g, '&quot;') + '"' : '') + '>' + d.toLocaleString('en-IN') + ' d</span>';
  }
  // "1 yr 2 mo" style text for long ages (tooltips)
  function words(d) {
    d = Math.max(0, Math.round(d));
    if (d < 31) return d + (d === 1 ? ' day' : ' days');
    if (d < 365) return Math.floor(d / 30) + ' mo ' + (d % 30) + ' d';
    return Math.floor(d / 365) + ' yr ' + Math.floor((d % 365) / 30) + ' mo';
  }
  window.AGE = { EDGES: EDGES, LABELS: LABELS, N: LABELS.length, bucket: bucket, label: function (d) { return LABELS[bucket(d)]; }, pill: pill, words: words };
})();

// Payment Ageing parties: the type of a party, the same on the Payment Ageing page and on the Summary.
// RM (raw material) parties and the Group companies (Mittal Coin, Mittal Appliances) are NOT taken: only the types in SHOW are listed and counted
// (user, 5-Nov-2026: "payment ageing se bhi RM & Group companies remove kro").
(function () {
  var ALL = ['Store', 'RM', 'Employees', 'Group', 'Others'];
  var SHOW = ['Store', 'Employees', 'Others'];
  var STORE_MT = ['ZCON', 'ZHMI', 'ZSPR', 'ZSRM', 'ZVRP'];
  // supplier number -> [Store items, RM items] of the PO data (/api/po); the RM items the server does not send any more come as po.rmSuppliers
  function info(po) {
    var m = new Map();
    function get(id) { var i = m.get(id); if (!i) m.set(id, i = [0, 0]); return i; }
    if (!po) return m;
    po.rows.forEach(function (a) {
      var i = get(po.suppliers[a[5]][0]);
      if (STORE_MT.indexOf(po.mtypes[a[11]]) >= 0 || po.pgs[a[19]] === '010') i[0]++;
      var pt = po.types[a[4]]; if (pt === 'ZDRM' || pt === 'ZIRM' || po.mtypes[a[11]] === 'ZRMA') i[1]++;
    });
    var rs = po.rmSuppliers || {};
    Object.keys(rs).forEach(function (id) { get(id)[1] += rs[id]; });
    return m;
  }
  // p = {id, name, grp (account group)}; mine = the type written in backend/data/party_types.csv; poi = info(po)
  // order: the hand-made list, the employee account group, the Mittal companies, its purchase orders (Store or RM, the one with more items), then the RM account group / name
  function type(p, mine, poi) {
    if (mine && ALL.indexOf(mine) >= 0) return mine;
    if (p.grp === 'EMPL') return 'Employees';
    if (/^mittal (coin|appliance)/i.test(p.name || '')) return 'Group';
    var i = poi && poi.get(p.id);
    if (i && (i[0] || i[1])) return i[1] && i[1] >= i[0] ? 'RM' : 'Store';
    if (p.grp === 'ZIRM' || /\(R\.?M\b|\bRM Purchase|\(RM\)/i.test(p.name || '')) return 'RM';
    return 'Others';
  }
  window.PARTY = { ALL: ALL, SHOW: SHOW, info: info, type: type, shown: function (t) { return SHOW.indexOf(t) >= 0; } };
})();
