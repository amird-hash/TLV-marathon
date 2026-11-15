/* schedule.js – קריאת שורות השיט לשבועות + שיבוץ ריצות לימים.
 * פונקציות טהורות. שבוע = שני עד ראשון. אזור זמן: Asia/Jerusalem.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./parser.js'));
  else root.Schedule = factory(root.Parser);
})(typeof self !== 'undefined' ? self : this, function (Parser) {
  'use strict';

  var DAYS = ['שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת', 'ראשון']; // אינדקס 0 = שני
  var RUN_KEYS = ['r1', 'r2', 'r3', 'r4', 'r5'];
  var RUN_LABELS = { r1: 'ריצה 1', r2: 'ריצה 2', r3: 'ריצה 3', r4: 'ריצה 4', r5: 'ריצה 5' };

  var DEFAULT_DAYS = {
    r1: { day: 'שני', locked: false },
    r2: { day: 'שלישי', locked: false },
    r3: { day: 'חמישי', locked: false },
    r4: { day: 'שבת', locked: false },
    r5: { day: 'שישי', locked: false }
  };

  function dayIndex(name) { return DAYS.indexOf(String(name || '').trim()); }

  // ---------- תאריכים ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function fmtJerusalem(d) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }
  function todayISO() { return fmtJerusalem(new Date()); }
  function addDays(isoDate, n) {
    var d = new Date(isoDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function isMonday(isoDate) { return new Date(isoDate + 'T00:00:00Z').getUTCDay() === 1; }

  // מקבל Date / "16/11/2026" / "2026-11-16" / ISO עם שעה → "YYYY-MM-DD" או null
  function parseWeekStart(v) {
    if (v === null || v === undefined || v === '') return null;
    if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v) ? null : fmtJerusalem(v);
    var s = String(v).trim(), m;
    m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})$/.exec(s);
    if (m) { var y = +m[3]; if (y < 100) y += 2000; return iso(y, +m[2], +m[1]); }
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { var dt = new Date(s); return isNaN(dt) ? null : fmtJerusalem(dt); }
    m = /^(\d{4}-\d{2}-\d{2})[ ]\d{2}:\d{2}/.exec(s);
    if (m) return m[1]; // התאריך כבר בשעון ירושלים מהשרת
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return null;
  }

  // ---------- קריאת השיט ----------
  function hdr(k) { return String(k).replace(/"/g, '״').replace(/\s+/g, ' ').trim(); }
  function pick(row, test) {
    for (var k in row) if (Object.prototype.hasOwnProperty.call(row, k) && test(hdr(k))) return row[k];
    return undefined;
  }
  var PRIVATE_HEADERS = /^(ק״מ בפועל|בוצעו ריצות|RPE שבועי|כאב 0-10|סטטוס|הערות \/ התאמות|סיכום לוואטסאפ)/;

  // values = מערך שורות גולמי מהשיט → מערך אובייקטים לפי שם כותרת.
  // מוצא את שורת הכותרות לפי התא "שבוע". includePrivate=false מסנן את עמודות המעקב הפרטיות.
  function valuesToRows(values, includePrivate) {
    var h = -1, i, j;
    for (i = 0; i < values.length && h < 0; i++) {
      for (j = 0; j < values[i].length; j++) if (hdr(values[i][j]) === 'שבוע') { h = i; break; }
    }
    if (h < 0) return [];
    var headers = values[h].map(hdr), rows = [];
    for (i = h + 1; i < values.length; i++) {
      var r = values[i], o = {}, any = false;
      for (j = 0; j < headers.length; j++) {
        if (!headers[j]) continue;
        if (!includePrivate && PRIVATE_HEADERS.test(headers[j])) continue;
        o[headers[j]] = r[j] === undefined ? '' : r[j];
        if (r[j] !== undefined && r[j] !== '') any = true;
      }
      if (any && String(o['שבוע'] || '').trim() !== '') rows.push(o);
    }
    return rows;
  }

  function plainNumber(s) {
    s = String(s === undefined || s === null ? '' : s).trim();
    return /^\d+(\.\d+)?$/.test(s) ? parseFloat(s) : null;
  }

  // שורה גולמית → שבוע מובנה (עדיין בלי שיבוץ)
  function normalizeWeek(row) {
    var cells = {
      r1: pick(row, function (h) { return /^ריצה 1/.test(h); }),
      r2: pick(row, function (h) { return /^ריצה 2/.test(h); }),
      r34: pick(row, function (h) { return /^ריצות 3-4/.test(h); }),
      r5: pick(row, function (h) { return /^ריצה 5/.test(h); })
    };
    var kmText = String(pick(row, function (h) { return /^ק״מ מתוכנן/.test(h); }) || '').trim();
    var start = parseWeekStart(pick(row, function (h) { return h === 'שבוע מתחיל'; }));
    var w = {
      period: String(pick(row, function (h) { return h === 'תקופה'; }) || '').trim(),
      week: parseInt(pick(row, function (h) { return h === 'שבוע'; }), 10),
      dates: String(pick(row, function (h) { return h === 'תאריכים'; }) || '').trim(),
      kmText: kmText,
      kmPlanned: plainNumber(kmText),
      weekStart: start,
      weekStartOk: start ? isMonday(start) : false,
      cells: cells
    };
    var notes = pick(row, function (h) { return h === 'הערות / התאמות'; });
    if (notes !== undefined) w.coachNotes = notes;
    return w;
  }

  function buildWeeks(values, includePrivate) {
    return valuesToRows(values, includePrivate).map(normalizeWeek)
      .filter(function (w) { return !isNaN(w.week); });
  }

  // ---------- ריצות של שבוע ----------
  function buildRuns(week) {
    var runs = [];
    function add(raw, key) { var r = Parser.parseRun(raw, key); if (r) runs.push(r); }
    add(week.cells.r1, 'r1');
    add(week.cells.r2, 'r2');
    Parser.splitRuns34(week.cells.r34).forEach(function (x) { add(x.text, x.key); });
    add(week.cells.r5, 'r5');
    return runs;
  }

  // ---------- טבלת ימים ----------
  // rows: [{ריצה:'ריצה 1', יום:'שני', נעול:'לא'}, ...] (כמו הלשונית) → {r1:{day,locked},...}
  function daysFromRows(rows) {
    var out = JSON.parse(JSON.stringify(DEFAULT_DAYS));
    (rows || []).forEach(function (r) {
      var m = /(\d)/.exec(String(r['ריצה'] || ''));
      if (!m || !out['r' + m[1]]) return;
      var k = 'r' + m[1], d = String(r['יום'] || '').trim();
      if (dayIndex(d) >= 0) out[k].day = d;
      out[k].locked = /^(כן|yes|true|1)$/i.test(String(r['נעול'] === undefined ? '' : r['נעול']).trim());
    });
    return out;
  }

  // שורות Schedule לפי סדר הוספה → המפתח האחרון קובע. יום ריק = חזרה למקור.
  // rows: [{שם, תכנית, שבוע, ריצה:'ריצה 3' או 'r3', יום}]
  function personalFor(rows, athlete, plan, weekNo) {
    var out = {};
    (rows || []).forEach(function (r) {
      if (String(r['שם']).trim() !== athlete || String(r['תכנית']).trim() !== plan) return;
      if (parseInt(r['שבוע'], 10) !== weekNo) return;
      var m = /(\d)/.exec(String(r['ריצה'] || ''));
      if (!m) return;
      out['r' + m[1]] = String(r['יום'] || '').trim(); // '' = איפוס
    });
    return out;
  }

  // ---------- שיבוץ ----------
  var HEAVY = { quality: 1, long: 1, test: 1, race: 1 };

  function scheduleWeek(week, opts) {
    opts = opts || {};
    var days = opts.days || DEFAULT_DAYS;
    var personal = opts.personal || {};
    var runs = buildRuns(week);
    runs.forEach(function (r) {
      var cfg = days[r.key] || DEFAULT_DAYS[r.key];
      r.locked = !!cfg.locked;
      var p = personal[r.key];
      if (p && dayIndex(p) >= 0 && !r.locked) { r.day = p; r.source = 'personal'; }
      else if (r.dayExplicit) { r.day = r.dayExplicit; r.source = 'text'; }
      else { r.day = cfg.day; r.source = 'default'; }
      r.dayIndex = dayIndex(r.day);
      r.date = week.weekStart ? addDays(week.weekStart, r.dayIndex) : null;
      r.warnings = [];
    });
    // אזהרות עדינות: ריצה קלה צמודה (או באותו יום) לאיכות/ארוכה
    runs.forEach(function (r) {
      if (r.type !== 'easy' && r.type !== 'recovery') return;
      runs.forEach(function (o) {
        if (o === r || !HEAVY[o.type]) return;
        var diff = Math.abs(o.dayIndex - r.dayIndex);
        if (diff === 0) r.warnings.push('באותו יום עם ' + RUN_LABELS[o.key]);
        else if (diff === 1 && r.source === 'personal') r.warnings.push('צמודה ליום של ' + RUN_LABELS[o.key]);
      });
    });
    var byDay = [[], [], [], [], [], [], []];
    runs.forEach(function (r) { if (r.dayIndex >= 0) byDay[r.dayIndex].push(r); });
    return { week: week.week, weekStart: week.weekStart, runs: runs, byDay: byDay };
  }

  // בדיקה שגם השרת יעשה: האם מותר להזיז ריצה ליום
  function canMove(runKey, toDay, days) {
    days = days || DEFAULT_DAYS;
    if (!days[runKey]) return { ok: false, error: 'ריצה לא מוכרת' };
    if (dayIndex(toDay) < 0) return { ok: false, error: 'יום לא תקין' };
    if (days[runKey].locked) return { ok: false, error: 'הריצה הזו נעולה (אימון קבוצתי) ואי אפשר להזיז אותה' };
    return { ok: true };
  }

  // ---------- איזה שבוע עכשיו ----------
  function findWeek(weeks, today) {
    var sorted = weeks.filter(function (w) { return w.weekStart; })
      .sort(function (a, b) { return a.weekStart < b.weekStart ? -1 : 1; });
    if (!sorted.length) return null;
    if (today < sorted[0].weekStart) return { state: 'before', week: sorted[0] };
    for (var i = sorted.length - 1; i >= 0; i--) {
      if (today >= sorted[i].weekStart) {
        return { state: today <= addDays(sorted[i].weekStart, 6) ? 'during' : 'after', week: sorted[i] };
      }
    }
    return null;
  }

  return {
    DAYS: DAYS, RUN_KEYS: RUN_KEYS, RUN_LABELS: RUN_LABELS, DEFAULT_DAYS: DEFAULT_DAYS,
    dayIndex: dayIndex, addDays: addDays, todayISO: todayISO, parseWeekStart: parseWeekStart,
    valuesToRows: valuesToRows, normalizeWeek: normalizeWeek, buildWeeks: buildWeeks,
    buildRuns: buildRuns, daysFromRows: daysFromRows, personalFor: personalFor,
    scheduleWeek: scheduleWeek, canMove: canMove, findWeek: findWeek
  };
});
