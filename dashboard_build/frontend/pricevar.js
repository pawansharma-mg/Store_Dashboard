/* Material price variance, worked out from the purchase order items of /api/po (the Pending Purchase Orders data, POs created from 1 Jan 2026).
   Used by the Price Variance page and by its card on the Summary, so both always give the same figures.

   The rate of a material is the net value in rupees divided by the order quantity of its PO lines (document currency x the PO exchange rate).
   Per material (and unit) there is one rate per PO date: lines of the same date are averaged by quantity, and a line worth less than 10% of the
   biggest line of that day (a near-free line, e.g. a free-of-charge item on the same PO) is left out.
   Left out altogether: stock transport orders (ZSTO, no purchase price), items without a material number, zero or negative quantity or value, and the PO lines
   delivered to the storage locations in EXCLUDE_LOCS (PS01 - PS06, NPD1, DROS = dross; any plant), at the user's word: those are production / job-work stores, not purchases
   for stock. The result says how many lines that was (excluded).

   PROFIT AND LOSS. The reference rate is the rate of the first PO date of the period (basis 'first') or of the PO date before the latest (basis 'prev').
   Every purchase after the reference date is compared with it: variance = (rate of that PO date - reference rate) x quantity bought on that date.
   Above the reference rate = LOSS (we paid more than at the reference rate), below it = PROFIT (we paid less). Per material: loss, profit and
   impact = loss - profit (positive = net loss). Nothing is sold here, so this is the purchase price variance, not a margin.

   Groups (option grp), decided per PO line, in this order:
     'RM'      the line is of a material of SAP material type ZRMA (Raw materials: copper, zinc, nickel, scrap, ingots; bought on the RM purchase orders ZDRM / ZIRM by
               purchasing group 020), wherever it is delivered;
     'PACKING' the FG (finished goods) material: material types ZFGS (finished goods), ZTRG (trading goods) and HAWA, wherever delivered, and any other line delivered to a
               packing / FG location (PACK_LOCS: 1030/GS02, 1050/GS03, 1040/MDFG, where the finished and trading goods come in: coins, medals, trophies, gifts, lota / jugs);
     'STORE'   the store material types (ZCON consumables, ZHMI tools, ZSPR spares, ZSRM, ZVRP packaging material) wherever delivered (many of them have no storage location on
               the PO line), and any other line delivered to one of the store locations of backend/data/stock_locations.csv (plant + storage location, sent with the PO data
               as po.storeLocs);
     'OTHER'   everything else (the semi-finished job-work ZSFG, processed scrap ...);
     ''        all.
   A material bought in two groups is compared in each group with its own lines.

   PRICEVAR.compute(po, {plant, mtype, grp, from, to, basis, min}) ->
     mats   every material with 2 or more PO dates inside the filters
     ups    the materials whose latest rate is at least `min` % above the reference rate
     downs  the materials whose latest rate is at least `min` % below it
   A material: {key, mat, unit, text, mtype, grp, days[], ref, last, chg, pct, impact, loss, profit, vs[], big, textDiff, supDiff, doubt, moves[]}
     days   one entry per PO date: {day, rate, qty, value, sups[], pos[], cur, doc, step, stepPct, vsRef}
            step = change from the PO date before, vsRef = variance against the reference rate (null for the reference date and the dates before it)
     vs     [{day, v}] the variances of the purchases after the reference date (month by month totals are made from these)
     moves  [{day, fromDay, from, to, pct, qty, amt, po, sup, rec}] every change from one PO date to the next of at least `min` %;
            amt = (to - from) x quantity of the later PO date (positive = loss against the PO before, negative = profit)
     big    the change is above +300% or below -75%: usually another item or unit under the same material number, or a wrong PO price
     textDiff the PO item texts of the reference date and of the latest date have nothing in common (another size or make)
     supDiff  the suppliers of the reference date and of the latest date have nothing in common
   PRICEVAR.totals(list) -> {loss, profit, net} of a list of materials (net = loss - profit). */
(function () {
  var STORE_MT = ['ZCON', 'ZHMI', 'ZSPR', 'ZSRM', 'ZVRP'];
  var RM_MT = ['ZRMA'];
  var FG_MT = ['ZFGS', 'ZTRG', 'HAWA'];
  var PACK_LOCS = ['1030|GS02', '1050|GS03', '1040|MDFG'];
  var EXCLUDE_LOCS = ['PS01', 'PS02', 'PS03', 'PS04', 'PS05', 'PS06', 'NPD1', 'DROS', 'DROSS'];  // storage codes, any plant
  var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
  var meet = function (a, b) { for (var x of a) if (b.has(x)) return true; return false; };

  // which group a PO line belongs to (see the top); with no list of store locations in the data every line that is not RM or FG counts as Store
  function classifier(po) {
    var set = po.storeLocs ? new Set(po.storeLocs.map(function (l) { return l[0] + '|' + l[1]; })) : null;
    return function (a) {
      var mt = po.mtypes[a[11]], loc = po.plants[a[6]] + '|' + (po.slocs[a[7]] || '');
      if (RM_MT.indexOf(mt) >= 0) return 'RM';
      if (FG_MT.indexOf(mt) >= 0 || PACK_LOCS.indexOf(loc) >= 0) return 'PACKING';
      if (STORE_MT.indexOf(mt) >= 0 || !set || set.has(loc)) return 'STORE';
      return 'OTHER';
    };
  }

  function compute(po, o) {
    o = Object.assign({ plant: '', mtype: '', grp: '', from: null, to: null, basis: 'first', min: 1 }, o || {});
    var groups = new Map(), grpOf = classifier(po), excluded = 0;
    for (var a of po.rows) {
      var mat = po.mats[a[8]];
      if (!mat) continue;
      var type = po.types[a[4]];
      if (type === 'ZSTO') continue;
      var qty = a[15], amt = a[17], rate = a[24];
      if (!(qty > 0 && amt > 0 && rate > 0)) continue;
      var day = a[1] !== null && a[1] !== undefined ? a[1] : a[0];
      if (day === null || day === undefined) continue;
      if (o.from !== null && day < o.from) continue;
      if (o.to !== null && day > o.to) continue;
      var plant = po.plants[a[6]];
      if (o.plant && plant !== o.plant) continue;
      if (EXCLUDE_LOCS.indexOf(po.slocs[a[7]] || '') >= 0) { excluded++; continue; }
      var mt = po.mtypes[a[11]];
      if (o.grp && grpOf(a) !== o.grp) continue;
      if (o.mtype && (o.mtype === 'STORE' ? STORE_MT.indexOf(mt) < 0 : mt !== o.mtype)) continue;
      var unit = po.units[a[13]], key = mat + '|' + unit, g = groups.get(key);
      if (!g) groups.set(key, g = { key: key, mat: mat, unit: unit, lines: [] });
      var s = po.suppliers[a[5]];
      g.lines.push({ day: day, po: a[2], item: a[3], sup: s[1] || s[0], qty: qty, inr: amt * rate, doc: amt, cur: po.curs[a[14]], text: po.texts[a[9]] || '', mt: mt, grp: po.groups[a[10]] });
    }
    var mats = [], ups = [], downs = [];
    for (var g of groups.values()) {
      var byDay = new Map();
      for (var l of g.lines) { var dl = byDay.get(l.day); if (!dl) byDay.set(l.day, dl = []); dl.push(l); }
      if (byDay.size < 2) continue;
      var days = [];
      for (var [d, dl2] of byDay) {
        var top = 0;
        for (var l2 of dl2) if (l2.inr > top) top = l2.inr;
        var main = dl2.filter(function (x) { return x.inr >= 0.1 * top; });
        var q = 0, v = 0, dv = 0, curs = new Set(), sups = new Set(), pos = new Set(), texts = new Set();
        for (var m of main) { q += m.qty; v += m.inr; dv += m.doc; curs.add(m.cur); sups.add(m.sup); pos.add(m.po); texts.add(norm(m.text)); }
        days.push({ day: d, rate: v / q, qty: q, value: v, sups: [...sups], supSet: sups, pos: [...pos], textSet: texts, cur: curs.size === 1 ? [...curs][0] : '', doc: curs.size === 1 ? dv / q : null, step: null, stepPct: null, vsRef: null });
      }
      days.sort(function (x, y) { return x.day - y.day; });
      var refIdx = o.basis === 'prev' ? days.length - 2 : 0;
      var last = days[days.length - 1], ref = days[refIdx];
      var pct = (last.rate - ref.rate) / ref.rate * 100;
      // profit and loss: every purchase after the reference date against the reference rate
      var vs = [], loss = 0, profit = 0;
      for (var i = refIdx + 1; i < days.length; i++) {
        var vv = (days[i].rate - ref.rate) * days[i].qty;
        days[i].vsRef = vv;
        vs.push({ day: days[i].day, v: vv });
        if (vv > 0) loss += vv; else profit -= vv;
      }
      // every change from one PO date to the next
      var moves = [];
      for (var j = 1; j < days.length; j++) {
        var p = (days[j].rate - days[j - 1].rate) / days[j - 1].rate * 100;
        days[j].step = days[j].rate - days[j - 1].rate;
        days[j].stepPct = p;
        if (Math.abs(p) >= o.min) moves.push({ day: days[j].day, fromDay: days[j - 1].day, from: days[j - 1].rate, to: days[j].rate, pct: p, qty: days[j].qty, amt: days[j].step * days[j].qty, po: days[j].pos[0], sup: days[j].sups[0] });
      }
      var newest = g.lines.reduce(function (a2, b2) { return b2.day >= a2.day ? b2 : a2; });
      var rec = {
        key: g.key, mat: g.mat, unit: g.unit, text: newest.text, mtype: newest.mt, grp: newest.grp, days: days, ref: ref, last: last,
        chg: last.rate - ref.rate, pct: pct, impact: loss - profit, loss: loss, profit: profit, vs: vs,
        big: pct >= 300 || pct <= -75, textDiff: !meet(ref.textSet, last.textSet), supDiff: !meet(ref.supSet, last.supSet), moves: moves
      };
      rec.doubt = rec.big || rec.textDiff;
      for (var mv of moves) mv.rec = rec;
      mats.push(rec);
      if (pct >= o.min) ups.push(rec); else if (pct <= -o.min) downs.push(rec);
    }
    return { mats: mats, ups: ups, downs: downs, excluded: excluded };
  }
  function totals(list) {
    var loss = 0, profit = 0;
    for (var r of list) { loss += r.loss; profit += r.profit; }
    return { loss: loss, profit: profit, net: loss - profit };
  }
  window.PRICEVAR = { compute: compute, totals: totals, classifier: classifier, STORE_MT: STORE_MT, RM_MT: RM_MT, FG_MT: FG_MT, PACK_LOCS: PACK_LOCS, EXCLUDE_LOCS: EXCLUDE_LOCS };
})();
