/**
 * סימון ביצוע: פירוק ריצה לחלקים שאפשר לסמן, הערכת ק״מ לביצוע חלקי,
 * וטקסט "פירוט" קצר לעמודה ב-Log (למשל "חימום ✓, 4/6 חזרות, שחרור ✗").
 * פונקציות טהורות – רצות גם בדפדפן וגם בבדיקות.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LogKit = factory();
})(this, function () {
  'use strict';

  var KIND = { warmup: 'חימום', main: 'סט מרכזי', cooldown: 'שחרור' };
  var STATUS_HE = { done: 'בוצע', partial: 'חלקי', skipped: 'דולג' };
  var STATUS_EN = { 'בוצע': 'done', 'חלקי': 'partial', 'דולג': 'skipped' };

  // "4×800 3:50-4:00" → {reps:4, each:0.8}; "2×3 ק״מ סף" → {reps:2, each:3}; "8×25 שנ׳" → {reps:8, each:0}
  function repsOf(text) {
    var m = /(\d+)\s*×\s*(\d+(?:\.\d+)?)\s*(ק״מ|מ׳|מטר|שנ׳|שניות|דק׳|דקות)?/.exec(text || '');
    if (!m) return null;
    var n = parseInt(m[1], 10), v = parseFloat(m[2]), unit = m[3] || '', each = null;
    if (unit === 'ק״מ') each = v;
    else if (unit === 'מ׳' || unit === 'מטר' || (!unit && v >= 100)) each = v / 1000;
    else if (unit === 'שנ׳' || unit === 'שניות') each = 0;
    if (n < 1 || n > 60) return null;
    return { reps: n, each: each };
  }

  // ק״מ של חלק: "3 ק״מ" / "2 ק״מ קל" → 3; חזרות לפי מרחק; אחרת null (לא ידוע)
  function kmOf(text) {
    var r = repsOf(text);
    if (r && r.each !== null) return Math.round(r.reps * r.each * 10) / 10;
    var m = /^~?(\d+(?:\.\d+)?)\s*(ק״מ)?(?![\d:×])/.exec(String(text || '').trim());
    if (m && (m[2] || /^\d+(\.\d+)?\s*(קל|התאוששות|steady|$)/i.test(String(text).trim()))) return parseFloat(m[1]);
    return null;
  }

  // חלקים לסימון: שלב, ואם יש לו תתי-שלבים – כל תת-שלב בנפרד
  function partsOf(run) {
    var parts = [];
    (run.steps || []).forEach(function (s, i) {
      var name = s.label || KIND[s.kind] || 'שלב';
      if (s.sub && s.sub.length) {
        if (s.text) parts.push(mk('p' + i, name, s.text, s.kind));
        s.sub.forEach(function (x, j) { parts.push(mk('p' + i + '_' + j, name, x, s.kind, true)); });
      } else {
        parts.push(mk('p' + i, name, s.text, s.kind));
      }
    });
    return parts;
  }
  function mk(id, name, text, kind, isSub) {
    var r = repsOf(text);
    return { id: id, name: name, text: text, kind: kind, sub: !!isSub, reps: r ? r.reps : null, km: kmOf(text) };
  }

  // sel: { id: { done: bool, reps: number } }
  // כשהק״מ של הריצה ידוע (סה״כ בשיט), ההערכה היא החלק היחסי ממנו – כך ריצה מלאה = הק״מ המתוכנן בדיוק
  function estimateKm(run, parts, sel) {
    if (!parts.length) return null;
    var all = 0, done = 0, known = true, frac = 0;
    parts.forEach(function (p) {
      var s = sel[p.id] || {};
      var f = !s.done ? 0 : p.reps ? Math.max(0, Math.min(p.reps, +s.reps || 0)) / p.reps : 1;
      frac += f;
      if (p.km === null) known = false; else { all += p.km; done += p.km * f; }
    });
    var planned = run.km !== null && run.km !== undefined ? run.km : null;
    if (planned !== null) return round1(known && all > 0 ? planned * done / all : planned * frac / parts.length);
    return known ? round1(done) : null;
  }
  // ק״מ ברירת מחדל ל"בוצע": המתוכנן, או סכום השלבים אם הוא ידוע
  function plannedKm(run) {
    if (run.km !== null && run.km !== undefined) return run.km;
    var parts = partsOf(run), sel = {};
    parts.forEach(function (p) { sel[p.id] = { done: true, reps: p.reps }; });
    return estimateKm(run, parts, sel);
  }
  function round1(n) { return Math.round(n * 10) / 10; }

  function detailText(parts, sel) {
    return parts.map(function (p) {
      var s = sel[p.id] || {};
      var label = p.sub ? shortText(p.text) : p.name;
      if (p.reps && s.done) {
        var done = Math.max(0, Math.min(p.reps, +s.reps || 0));
        return (done === p.reps ? label + ' ✓' : (p.sub ? label + ' ' : '') + done + '/' + p.reps + ' חזרות');
      }
      return label + (s.done ? ' ✓' : ' ✗');
    }).join(', ');
  }
  function shortText(t) { t = String(t || ''); return t.length > 18 ? t.slice(0, 18) + '…' : t; }

  // תאריך ברירת מחדל: היום המשובץ אם כבר עבר, אחרת היום
  function defaultDate(runDate, today) { return runDate && runDate <= today ? runDate : today; }

  // שורות Log (מהשיט) → מפה "שבוע|rN" → רשומה אחרונה
  function logMap(rows) {
    var out = {};
    (rows || []).forEach(function (r) {
      var m = /(\d)/.exec(String(r['ריצה'] || ''));
      if (!m) return;
      var km = r['ק״מ בפועל'], rpe = r['RPE 1-10'], pain = r['כאב 0-10'];
      out[parseInt(r['שבוע'], 10) + '|r' + m[1]] = {
        status: STATUS_EN[String(r['סטטוס']).trim()] || 'done',
        km: num(km), rpe: num(rpe), pain: num(pain),
        date: String(r['תאריך ביצוע'] || '').slice(0, 10), detail: String(r['פירוט'] || ''), note: String(r['הערה'] || '')
      };
    });
    return out;
  }
  function num(v) { if (v === '' || v === null || v === undefined) return null; var n = Number(v); return isNaN(n) ? null : n; }

  return {
    KIND: KIND, STATUS_HE: STATUS_HE, STATUS_EN: STATUS_EN,
    repsOf: repsOf, kmOf: kmOf, partsOf: partsOf, estimateKm: estimateKm, plannedKm: plannedKm,
    detailText: detailText, defaultDate: defaultDate, logMap: logMap
  };
});
