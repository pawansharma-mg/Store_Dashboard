/* Material price variance, worked out from the purchase order items of /api/po (the Pending Purchase Orders data, POs created from 1 Jan 2026).
   Used by the Price Variance page and by its card on the Summary, so both always give the same figures.

   The rate of a material is the net value in rupees divided by the order quantity of its PO lines (document currency x the PO exchange rate).
   Per material (and unit) there is one rate per PO date: lines of the same date are averaged by quantity, and a line worth less than 10% of the
   biggest line of that day (a near-free line, e.g. a free-of-charge item on the same PO) is left out.
   Left out altogether: stock transport orders (ZSTO, no purchase price), items without a material number, zero or negative quantity or value, and the PO lines
   delivered to the storage locations in EXCLUDE_LOCS (PS01 - PS06, NPD1, DROS = dross; any plant), at the user's word: those are production / job-work stores, not purchases
   for stock. The result says how many lines that was (excluded).
   Also left out (user, 29-Oct-2026: "Silver Gold ke materials Remove hi kar do jo Gram me measure ho"): the PO lines of SILVER and GOLD materials measured in grams, i.e. the order unit
   is a gram (GRAM_UNITS: G, GM) AND the item text names silver or gold (METAL_RE: coins, bullion, articles, LSA trays, wire, Ag / 925 / 995 / 916 / 999; their price follows the metal
   market). A gram line that is not silver or gold stays (the user asked for all the data of the plants 1010 and 2010: an AC gas oil of the plant 1010 had been dropped by mistake
   when every gram line was left out). The result says how many lines were left out (excludedGram).

   ONE ITEM, ONE SERIES (user, 29-Oct-2026: "per pc kitna rate badh raha hai ghat raha hai, proper analysis karke"): a rate is compared only with the rate of the SAME item. Normally the item is the
   material number + the unit. But some material numbers are used for many different items (a generic number: 35 different fittings of different sizes and makes under 1400008249, so a CPVC
   fitting at Rs 76 was set against an ULTRAPRESS coupling at Rs 2,700 and made a profit that was not real). Such a material is found by its PO lines: two different item texts on the SAME PO date
   (genericMats). For a generic material every item text is its own series: key = material|unit|item text, shown with the text as its name and the pill "item-wise rate". A material whose item
   text only changes over time (never two texts on one day) stays one series. On 29-Oct-2026 48 of the 1,637 compared materials were generic.

   PROFIT AND LOSS. The reference rate is the rate of the first PO date of the period (basis 'first') or of the PO date before the latest (basis 'prev').
   Every purchase after the reference date is compared with it: variance = (rate of that PO date - reference rate) x quantity bought on that date.
   Above the reference rate = LOSS (we paid more than at the reference rate), below it = PROFIT (we paid less). Per material: loss, profit and
   impact = loss - profit (positive = net loss). Nothing is sold here, so this is the purchase price variance, not a margin.

   Groups (option grp), decided per PO line, in this order (user, 28-Oct-2026: "RM ka material analysis karke RM me, Silver Gold Medal depart, baki Store"):
     'RM'      raw material: the material number starts with 11 (the 11 series, SAP type ZRMA: copper, zinc, nickel, scrap, ingots; the first two digits of a number are its
               type) except a finished-goods type (one medal is numbered 11...), wherever it is delivered; and what the RM purchase itself buys although the number is not 11:
               purchasing group 020 (VP Purchase) on a purchase order ZDRM / ZIRM / ZTRD (RM_PG, RM_PO): Copper Wire Rod 1200000292 and Copper Ingot 1200000410 (12... =
               trading goods by number, plant 1010, location ML93), Lead Scrap Radio 1200001480 and two brass strips (ZSFG, plant 2010);
     'PACKING' the SILVER / GOLD / MEDAL department (key kept as PACKING for the old links). SWITCHED OFF on 29-Oct-2026 (user: "ye materials ko bhi store me dalo", about the medals,
               gifts, dies, packaging, copper bar that were left in it once the silver and gold bought by the gram were removed): SGM_PLANTS and PACK_LOCS are empty, so no line goes
               here and everything that is not RM is Store. To switch it on again fill them (1030, 1050 and the locations 1030/GS02, 1050/GS03). It was: the finished and trading goods of the plants 1030 and 1050 (SGM_PLANTS: material
               types ZFGS, ZTRG, HAWA = silver and gold coins, bullion, silver articles, medals, trophies, gifts, lota / jugs) and any line delivered to their locations
               PACK_LOCS (1030/GS02, 1050/GS03). The plant 1040 (Medal) is left out of the whole dashboard (EXCLUDE_PLANTS in pr_data.py);
     'STORE'   everything else (the rest is Store): consumables, spares, tools, store raw materials, the other lines of the plants 1010, 2010 ... A trading good of another plant
               (e.g. the lead wire 1200000398 of plant 1010) is Store too;
     ''        all.
   A material bought in two groups is compared in each group with its own lines.

   PRICEVAR.compute(po, {plant, mtype, grp, from, to, basis, min}) ->
     mats   every material with 2 or more PO dates inside the filters
     ups    the materials whose latest rate is at least `min` % above the reference rate
     downs  the materials whose latest rate is at least `min` % below it
   A material: {key, mat, unit, split, text, mtype, grp, days[], ref, last, chg, pct, impact, loss, profit, vs[], big, textDiff, supDiff, doubt, moves[]}
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
  var INCLUDE_RM = false;                   // user, 4-Nov-2026: "isme se RM hta do, price variance me": the RM lines are left out of the price variance (set true to bring them back)
  var RM_CODE = '11';                       // the 11 series of the material number = raw material
  var RM_PG = ['020'];                      // purchasing group 020 = VP Purchase, the RM purchase
  var RM_PO = ['ZDRM', 'ZIRM', 'ZTRD'];     // the purchase orders it buys on (a stock transport order ZSTO is not a purchase)
  var SGM_PLANTS = [];  // the silver / gold / medal department is switched off (it was ['1030', '1050']): its materials are Store
  var FG_MT = ['ZFGS', 'ZTRG', 'HAWA'];
  var PACK_LOCS = [];  // it was ['1030|GS02', '1050|GS03']
  var GRAM_UNITS = ['G', 'GM'];                // silver and gold are bought by the gram ...
  var METAL_RE = /silver|gold|bullion|\bag\b|sil\s*925|925|995|916|999/i;  // ... and named so: such a line is not part of the price variance
  var EXCLUDE_LOCS = ['PS01', 'PS02', 'PS03', 'PS04', 'PS05', 'PS06', 'NPD1', 'DROS', 'DROSS'];  // storage codes, any plant
  var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
  var meet = function (a, b) { for (var x of a) if (b.has(x)) return true; return false; };

  // the generic material numbers: two different item texts on the same PO date (the lines left out of the price variance are not counted; the filters of the page do not matter, so a
  // material is split the same way in every tab). Worked out once per data set.
  function genericMats(po) {
    if (po._gen) return po._gen;
    var seen = new Map(), gen = new Set();
    for (var a of po.rows) {
      var mat = po.mats[a[8]];
      if (!mat || po.types[a[4]] === 'ZSTO') continue;
      if (!(a[15] > 0 && a[17] > 0 && a[24] > 0)) continue;
      var day = a[1] !== null && a[1] !== undefined ? a[1] : a[0];
      if (day === null || day === undefined) continue;
      if (EXCLUDE_LOCS.indexOf(po.slocs[a[7]] || '') >= 0) continue;
      var un = po.units[a[13]];
      if (GRAM_UNITS.indexOf(String(un || '').toUpperCase()) >= 0 && METAL_RE.test(po.texts[a[9]] || '')) continue;
      var gk = mat + '|' + un;
      if (gen.has(gk)) continue;
      var dk = gk + '|' + day, t = norm(po.texts[a[9]]), first = seen.get(dk);
      if (first === undefined) seen.set(dk, t); else if (first !== t) gen.add(gk);
    }
    return (po._gen = gen);
  }

  // which group a PO line belongs to (see the top): RM, the silver / gold / medal department (PACKING), and everything else is Store
  function classifier(po) {
    return function (a) {
      var mt = po.mtypes[a[11]], plant = po.plants[a[6]], loc = plant + '|' + (po.slocs[a[7]] || '');
      if ((String(po.mats[a[8]] || '').indexOf(RM_CODE) === 0 && FG_MT.indexOf(mt) < 0) ||
          (RM_PG.indexOf(po.pgs[a[19]]) >= 0 && RM_PO.indexOf(po.types[a[4]]) >= 0)) return 'RM';
      if (PACK_LOCS.indexOf(loc) >= 0 || (FG_MT.indexOf(mt) >= 0 && SGM_PLANTS.indexOf(plant) >= 0)) return 'PACKING';
      return 'STORE';
    };
  }

  function compute(po, o) {
    o = Object.assign({ plant: '', mtype: '', grp: '', from: null, to: null, basis: 'first', min: 1 }, o || {});
    var groups = new Map(), grpOf = classifier(po), excluded = 0, excludedGram = 0, gen = genericMats(po);
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
      if (!INCLUDE_RM && grpOf(a) === 'RM') continue;
      if (EXCLUDE_LOCS.indexOf(po.slocs[a[7]] || '') >= 0) { excluded++; continue; }
      if (GRAM_UNITS.indexOf(String(po.units[a[13]] || '').toUpperCase()) >= 0 && METAL_RE.test(po.texts[a[9]] || '')) { excludedGram++; continue; }
      var mt = po.mtypes[a[11]];
      if (o.grp && grpOf(a) !== o.grp) continue;
      if (o.mtype && (o.mtype === 'STORE' ? STORE_MT.indexOf(mt) < 0 : mt !== o.mtype)) continue;
      var unit = po.units[a[13]], key = mat + '|' + unit, split = gen.has(key);
      if (split) key += '|' + norm(po.texts[a[9]]).slice(0, 80);  // a generic material number: one series per item text
      var g = groups.get(key);
      if (!g) groups.set(key, g = { key: key, mat: mat, unit: unit, split: split, lines: [] });
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
        key: g.key, mat: g.mat, unit: g.unit, split: g.split, text: newest.text, mtype: newest.mt, grp: newest.grp, days: days, ref: ref, last: last,
        chg: last.rate - ref.rate, pct: pct, impact: loss - profit, loss: loss, profit: profit, vs: vs,
        big: pct >= 300 || pct <= -75, textDiff: !meet(ref.textSet, last.textSet), supDiff: !meet(ref.supSet, last.supSet), moves: moves
      };
      rec.doubt = rec.big || rec.textDiff;
      for (var mv of moves) mv.rec = rec;
      mats.push(rec);
      if (pct >= o.min) ups.push(rec); else if (pct <= -o.min) downs.push(rec);
    }
    return { mats: mats, ups: ups, downs: downs, excluded: excluded, excludedGram: excludedGram };
  }
  function totals(list) {
    var loss = 0, profit = 0;
    for (var r of list) { loss += r.loss; profit += r.profit; }
    return { loss: loss, profit: profit, net: loss - profit };
  }
  window.PRICEVAR = { compute: compute, totals: totals, classifier: classifier, STORE_MT: STORE_MT, RM_MT: RM_MT, RM_CODE: RM_CODE, GRAM_UNITS: GRAM_UNITS, METAL_RE: METAL_RE, RM_PG: RM_PG, RM_PO: RM_PO, SGM_PLANTS: SGM_PLANTS, FG_MT: FG_MT, PACK_LOCS: PACK_LOCS, EXCLUDE_LOCS: EXCLUDE_LOCS };
})();
