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
