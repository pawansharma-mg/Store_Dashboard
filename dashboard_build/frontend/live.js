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
