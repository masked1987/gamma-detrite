/* Vanna and Charm per option and totals (Gamma Detrite's Vanna & Charm view).
   Same code as fragility/shared/vanna-flow/core.mjs, which the ETH phone alert runs;
   `CRYPTO_GAMMA_CHECKOUT=<folder holding gamma-detrite> node test/vanna-flow.mjs` in the
   fragility repo checks they still match. Dealers assumed long calls, short puts. */
var GreekAnalytics = (function () {
  var DAY = 864e5, YEAR = 365 * DAY, PHI = Math.sqrt(2 * Math.PI);
  function cdf(x) {
    var z = Math.abs(x), t = 1 / (1 + 0.2316419 * z);
    var p = Math.exp(-z * z / 2) / PHI * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x >= 0 ? 1 - p : p;
  }
  function valid(o, spot, now) {
    return [spot, o.strike, o.oi, o.iv, o.forward].every(function (x) { return Number.isFinite(x) && x > 0; }) &&
      Number.isFinite(o.expiry) && o.expiry > now && (o.sign === 1 || o.sign === -1);
  }
  function greeks(o, spot, now) {
    if (!valid(o, spot, now)) return null;
    var T = (o.expiry - now) / YEAR, v = o.iv * Math.sqrt(T), r = Math.log(o.forward / spot) / T;
    var d1 = (Math.log(o.forward / o.strike) + v * v / 2) / v, d2 = d1 - v;
    var density = Math.exp(-d1 * d1 / 2) / PHI;
    // Vanna per +1 percentage point of IV; Charm per one calendar day elapsed.
    var vanna = -density * d2 / o.iv * 0.01;
    var charm = density * (d2 / (2 * T) - r / v) / 365;
    var delta = cdf(d1) - (o.sign === -1 ? 1 : 0);
    return { vanna: vanna, charm: charm, delta: delta, rate: r, T: T };
  }
  function prepare(book, expiries) {
    if (!book || !Array.isArray(book.options)) return null;
    var dates = new Set(expiries), records = [], excluded = 0;
    book.options.forEach(function (o) {
      if (!dates.has(o.expiry)) return;
      var g = greeks(o, book.spot, book.now);
      if (!g) { excluded++; return; }
      var scale = o.sign * o.oi * book.spot;
      records.push({ option: o, g: g, vanna: g.vanna * scale, charm: g.charm * scale });
    });
    if (!records.length) return null;
    var total = { vanna: 0, charm: 0, grossVanna: 0, grossCharm: 0, oi: 0 }, strikes = new Map(), expiryRows = new Map();
    records.forEach(function (r) {
      total.vanna += r.vanna; total.charm += r.charm;
      total.grossVanna += Math.abs(r.vanna); total.grossCharm += Math.abs(r.charm); total.oi += r.option.oi;
      [[strikes, r.option.strike], [expiryRows, r.option.expiry]].forEach(function (pair) {
        if (!pair[0].has(pair[1])) pair[0].set(pair[1], { key: pair[1], vanna: 0, charm: 0, oi: 0, count: 0 });
        var row = pair[0].get(pair[1]); row.vanna += r.vanna; row.charm += r.charm; row.oi += r.option.oi; row.count++;
      });
    });
    return { spot: book.spot, now: book.now, records: records, total: total, excluded: excluded,
      strikes: Array.from(strikes.values()).sort(function (a, b) { return a.key - b.key; }),
      expiries: Array.from(expiryRows.values()).sort(function (a, b) { return a.key - b.key; }) };
  }
  return { cdf: cdf, valid: valid, greeks: greeks, prepare: prepare, DAY: DAY };
})();
