/* app.js – מסכי האפליקציה. שלב 2: נתוני דוגמה מקומיים, בלי גוגל. */
(function () {
  'use strict';
  var CFG = window.CONFIG, P = window.Parser, S = window.Schedule;

  // ---------- קבועים ----------
  var TYPE = {
    easy: { name: 'קלה', icon: '' }, recovery: { name: 'התאוששות', icon: '' }, quality: { name: 'איכות', icon: '' },
    long: { name: 'ארוכה', icon: '' }, test: { name: 'טסט', icon: '⏱' }, race: { name: 'תחרות', icon: '🏁' }, cross: { name: 'משלים', icon: '' }
  };
  var KIND = { warmup: 'חימום', main: 'סט מרכזי', cooldown: 'שחרור' };
  var MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  var PERIOD_CLASS = function (p) { return /הורדה|טייפר/.test(p) ? 'p-down' : /שיא|תחרות/.test(p) ? 'p-peak' : /בנייה/.test(p) ? 'p-build' : 'p-base'; };
  var TERMS = [
    { re: /(?<![֐-׿])(קל|קלה|קלות)(?![֐-׿])/g, topic: 'קל / התאוששות' },
    { re: /(?<![֐-׿])התאוששות(?![֐-׿])/g, topic: 'קל / התאוששות' },
    { re: /steady/gi, topic: 'Steady' },
    { re: /(?<![֐-׿])(סף|טמפו)(?![֐-׿])/g, topic: 'סף / טמפו' },
    { re: /(?<![֐-׿])קצב (מטרה|תחרות|מרתון)(?![֐-׿])/g, topic: 'קצב מטרה' },
    { re: /אינטרוולים/g, topic: 'אינטרוולים' }
  ];

  // ---------- עזרים ----------
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* פרטי / חסום – ממשיכים בלי */ } }
  function dm(iso) { var p = iso.split('-'); return (+p[2]) + '.' + (+p[1]); }
  function dayOfMonth(iso) { return +iso.slice(8); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5); }
  function fmtKm(n) { return (Math.round(n * 10) / 10).toString(); }
  function ltr(s) { return '<bdi>' + esc(s) + '</bdi>'; }
  // מסמן מילות קצב בטקסט. מעבר אחד על הטקסט המקורי, כדי שלא יוחלפו מילים בתוך ה-HTML שכבר נוצר.
  function linkTerms(text) {
    var hits = [];
    TERMS.forEach(function (t) {
      t.re.lastIndex = 0; var m;
      while ((m = t.re.exec(text))) hits.push({ s: m.index, e: m.index + m[0].length, topic: t.topic });
    });
    hits.sort(function (a, b) { return a.s - b.s || b.e - a.e; });
    var out = '', pos = 0;
    hits.forEach(function (h) {
      if (h.s < pos) return;
      out += esc(text.slice(pos, h.s)) + '<button class="term" data-act="term" data-topic="' + esc(h.topic) + '">' + esc(text.slice(h.s, h.e)) + '</button>';
      pos = h.e;
    });
    return out + esc(text.slice(pos));
  }
  function qs(name) { var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search); return m ? decodeURIComponent(m[1]) : null; }

  // ---------- מצב ----------
  var st = {
    today: qs('today') || S.todayISO(),
    athlete: lsGet('athlete', null),
    screen: lsGet('screen', 'week'),
    weekNo: null, month: null, monthView: 'grid',
    weeks: [], settings: [], days: S.DEFAULT_DAYS, moves: CFG.SAMPLE ? lsGet('moves', []) : [], log: {}, apiLog: [],
    athletes: CFG.SAMPLE ? CFG.SAMPLE_ATHLETES : lsGet('athletes', []), loading: false, error: null
  };
  var sched = {}; // weekNo → תוצאת שיבוץ (מחושב מחדש בכל שינוי)

  function plan() {
    var a = st.athletes.filter(function (x) { return x.name === st.athlete; })[0];
    return a ? a.plan : null;
  }

  // ---------- חיבור ל-Apps Script ----------
  function apiGet(params) {
    var q = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    return fetch(CFG.API_URL + '?' + q).then(function (r) { return r.json(); });
  }
  function apiPost(body) {
    body.pin = CFG.PIN || '';
    // text/plain כדי למנוע preflight (CORS) מול Apps Script
    return fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }
  var NET_ERR = 'אין חיבור לשיט – נסה לרענן';

  function applyPlan(res) {
    st.weeks = res.plan.map(S.normalizeWeek).filter(function (w) { return !isNaN(w.week); });
    st.settings = res.settings || [];
    st.days = S.daysFromRows(res.days);
    st.moves = res.schedule || [];
    st.apiLog = res.log || [];
    recompute();
    buildLog();
  }

  // מציג מיד את מה ששמור במכשיר, ומרענן ברקע
  function loadData() {
    if (CFG.SAMPLE) {
      var P0 = window.SAMPLE_PLAN;
      applyPlan({ plan: S.valuesToRows(P0.tabs[plan()], false), settings: P0.settings, days: P0.days, schedule: lsGet('moves', []), log: [] });
      return;
    }
    var cached = lsGet('planCache:' + st.athlete, null);
    if (cached) { applyPlan(cached); }
    st.loading = true; st.error = null;
    apiGet({ action: 'plan', athlete: st.athlete }).then(function (res) {
      st.loading = false;
      if (!res.ok) { st.error = res.error; render(); return; }
      lsSet('planCache:' + st.athlete, res);
      applyPlan(res); render();
    }).catch(function () {
      st.loading = false;
      if (!st.weeks.length) st.error = NET_ERR;
      render();
    });
  }
  function loadAthletes() {
    if (CFG.SAMPLE) return;
    apiGet({ action: 'athletes' }).then(function (res) {
      if (!res.ok) return;
      st.athletes = res.athletes; lsSet('athletes', st.athletes);
      if (st.athlete && !plan()) { st.athlete = null; lsSet('athlete', null); }
      else if (st.athlete && !st.weeks.length) loadData();
      render();
    }).catch(function () { render(); });
  }

  function recompute() {
    sched = {};
    st.weeks.forEach(function (w) {
      var personal = S.personalFor(st.moves, st.athlete, plan(), w.week);
      sched[w.week] = S.scheduleWeek(w, { days: st.days, personal: personal });
    });
  }

  // יומן: מהשיט (שורה אחרונה לכל ריצה קובעת). במצב דוגמה – יומן מדומה כדי לראות איך זה נראה
  function buildLog() {
    st.log = {};
    if (!CFG.SAMPLE) {
      var map = { 'בוצע': 'done', 'חלקי': 'partial', 'דולג': 'skipped' };
      st.apiLog.forEach(function (r) {
        var m = /(\d)/.exec(String(r['ריצה']));
        if (!m) return;
        var km = r['ק״מ בפועל'];
        st.log[parseInt(r['שבוע'], 10) + '|r' + m[1]] = { status: map[String(r['סטטוס']).trim()] || 'done', km: km === '' || km === undefined ? null : Number(km) };
      });
      return;
    }
    st.weeks.forEach(function (w) {
      sched[w.week].runs.forEach(function (r, i) {
        if (!r.date || r.date >= st.today) return;
        var partial = (w.week + i) % 7 === 0;
        st.log[w.week + '|' + r.key] = { status: partial ? 'partial' : 'done', km: r.km === null ? null : (partial ? Math.round(r.km * 0.7) : r.km) };
      });
    });
  }
  function logOf(w, r) { return st.log[w + '|' + r.key] || null; }
  function weekDoneKm(w) {
    var sum = 0;
    sched[w.week].runs.forEach(function (r) { var l = logOf(w.week, r); if (l && l.km) sum += l.km; });
    return sum;
  }
  function weekByStart(iso) { return st.weeks.filter(function (w) { return w.weekStart === iso; })[0]; }
  function weekByNo(n) { return st.weeks.filter(function (w) { return w.week === n; })[0]; }

  // ---------- רכיבים קטנים ----------
  function chip(type) { return '<span class="chip t-' + type + '">' + (TYPE[type].icon ? TYPE[type].icon + ' ' : '') + TYPE[type].name + '</span>'; }
  function check(l) { return l ? (l.status === 'done' ? '<span class="done" title="בוצע">✓</span>' : l.status === 'partial' ? '<span class="partial" title="חלקי">◐</span>' : '') : ''; }
  var LOCK = '<svg class="lock" viewBox="0 0 16 16" width="13" height="13" aria-label="נעולה"><path fill="currentColor" d="M5 7V5a3 3 0 0 1 6 0v2h1v7H4V7zm1.5 0h3V5a1.5 1.5 0 0 0-3 0z"/></svg>';
  function runSummary(r) {
    if (r.type === 'race') return r.intro || r.steps[0].text;
    var main = r.steps.filter(function (s) { return s.kind === 'main'; });
    var parts = main.length ? main.map(function (s) { return (s.label ? s.label + ': ' : '') + s.text; }) : r.steps.map(function (s) { return s.text; });
    var t = (r.intro ? r.intro + ' · ' : '') + parts.join(' + ');
    return t;
  }
  function runKmLabel(r) { return r.km === null ? '' : fmtKm(r.km) + ' ק״מ'; }

  function legend() {
    return '<div class="legend">' + ['easy', 'quality', 'long', 'recovery', 'test', 'race', 'cross'].map(function (t) {
      return '<span class="lg"><i class="dot t-' + t + '"></i>' + TYPE[t].name + '</span>';
    }).join('') + '</div>';
  }

  // ---------- מסך בחירת שם ----------
  function viewPick() {
    return '<main class="pick"><div class="hero-sun"></div><h1>מרתון תל אביב</h1><p class="sub">26.2.2027 · מי אתה?</p>' +
      '<div class="names">' + st.athletes.map(function (a) {
        return '<button class="name" data-act="pick" data-name="' + esc(a.name) + '">' + esc(a.name) + '</button>';
      }).join('') + '</div></main>';
  }

  // ---------- כרטיס "היום" בראש הבית ----------
  function nextRunAfter(date) {
    var best = null;
    st.weeks.forEach(function (w) {
      sched[w.week].runs.forEach(function (r) {
        if (r.date && r.date > date && (!best || r.date < best.r.date)) best = { w: w, r: r };
      });
    });
    return best;
  }
  function todayHero(found) {
    if (found.state === 'after') return '';
    var today = st.today, h = '<section class="thero">';
    var todays = [];
    st.weeks.forEach(function (w) { sched[w.week].runs.forEach(function (r) { if (r.date === today) todays.push({ w: w, r: r }); }); });
    var dayName = S.DAYS[(new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7];
    if (todays.length) {
      h += '<div class="tlabel">היום · ' + dayName + ' ' + dm(today) + '</div>';
      todays.forEach(function (x) { h += runCard(x.w, x.r); });
    } else {
      var nx = nextRunAfter(today);
      h += '<div class="tlabel">' + (found.state === 'before' ? 'התכנית עוד לא התחילה' : 'היום · ' + dayName + ' ' + dm(today)) + '</div>' +
        '<div class="trest"><b>' + (found.state === 'before' ? 'מתחילים בקרוב' : 'היום מנוחה') + '</b>' +
        (nx ? '<div class="tnext" data-act="open" data-week="' + nx.w.week + '" data-key="' + nx.r.key + '">' +
          '<span class="tn-l">' + (found.state === 'before' ? 'הריצה הראשונה' : 'הריצה הבאה') + ' · ' + esc(nx.r.day) + ' ' + dm(nx.r.date) + '</span>' +
          '<span class="tn-r">' + chip(nx.r.type) + '<span class="rkm">' + ltr(runKmLabel(nx.r)) + '</span></span>' +
          '<span class="tn-s">' + ltr(runSummary(nx.r)) + '</span></div>' : '') + '</div>';
    }
    return h + '</section>';
  }

  // ---------- מסך שבוע ----------
  function viewWeek() {
    var found = S.findWeek(st.weeks, st.today);
    if (st.weekNo === null) st.weekNo = found.week.week;
    var w = weekByNo(st.weekNo) || found.week;
    var s = sched[w.week];
    var idx = st.weeks.indexOf(w);
    var done = weekDoneKm(w);
    var left = daysBetween(st.today, CFG.MARATHON_DATE);
    var h = '<main class="week" id="weekMain">';
    if (found.state === 'before' && w.week === found.week.week) {
      var d0 = found.week.weekStart;
      h += '<div class="banner">התכנית מתחילה ביום שני ' + dm(d0) + ' · זה שבוע ' + found.week.week + '</div>';
    }
    h += '<header class="whead ' + PERIOD_CLASS(w.period) + '">' +
      '<div class="wtop"><button class="nav" data-act="prev" ' + (idx <= 0 ? 'disabled' : '') + ' aria-label="שבוע קודם">→</button>' +
      '<div class="wtitle"><div class="wnum">שבוע ' + w.week + '</div><div class="wper">' + esc(w.period) + ' · ' + (w.weekStart ? '<bdi dir="ltr">' + dm(w.weekStart) + ' – ' + dm(S.addDays(w.weekStart, 6)) + '</bdi>' : esc(w.dates)) + '</div></div>' +
      '<button class="nav" data-act="next" ' + (idx >= st.weeks.length - 1 ? 'disabled' : '') + ' aria-label="שבוע הבא">←</button></div>' +
      '<div class="wstats"><div><b>' + ltr(w.kmText || '—') + '</b><span>ק״מ מתוכנן</span></div>' +
      '<div><b>' + fmtKm(done) + '</b><span>ק״מ בוצע</span></div>' +
      '<div><b>' + (left > 0 ? left : 0) + '</b><span>ימים למרתון</span></div></div>' + progressBar(w.kmPlanned || firstNum(w.kmText), done) + '</header>';
    if (w.week === found.week.week) h += todayHero(found);
    h += '<div class="days">';
    S.DAYS.forEach(function (dn, i) {
      var date = w.weekStart ? S.addDays(w.weekStart, i) : null;
      var runs = s.byDay[i];
      var isToday = date === st.today;
      h += '<section class="day' + (isToday ? ' today' : '') + (date && date < st.today ? ' past' : '') + '">' +
        '<div class="dlabel"><b>' + dn + '</b><span>' + (date ? dm(date) : '') + '</span>' + (isToday ? '<em>היום</em>' : '') + '</div><div class="druns">';
      if (!runs.length) h += '<div class="rest">מנוחה</div>';
      runs.forEach(function (r) { h += runRow(w, r); });
      h += '</div></section>';
    });
    h += '</div>';
    var anyMoved = s.runs.some(function (r) { return r.source === 'personal'; });
    if (anyMoved) h += '<button class="ghost" data-act="resetweek">↺ החזר את השבוע לשיבוץ המקורי</button>';
    h += legend() + '</main>';
    return h;
  }
  function firstNum(t) { var m = /(\d+(?:\.\d+)?)/.exec(t || ''); return m ? parseFloat(m[1]) : 0; }
  function progressBar(planned, done) {
    var pct = planned ? Math.min(100, Math.round(done / planned * 100)) : 0;
    return '<div class="bar" role="progressbar" aria-valuenow="' + pct + '"><i style="width:' + pct + '%"></i></div>';
  }
  function runRow(w, r) {
    var l = logOf(w.week, r);
    return '<article class="run t-' + r.type + '" data-act="open" data-week="' + w.week + '" data-key="' + r.key + '" data-lp="1">' +
      '<div class="rtop">' + chip(r.type) + '<span class="rkm">' + ltr(runKmLabel(r)) + '</span>' + (r.locked ? LOCK : '') + check(l) +
      (r.source === 'personal' ? '<span class="moved" title="הוזזה">⇄</span>' : '') + '</div>' +
      '<div class="rsum">' + ltr(runSummary(r)) + (r.optional ? ' <em class="opt">אופציונלי</em>' : '') + '</div>' +
      (r.warnings.length ? '<div class="warn">⚠ ' + esc(r.warnings.join(' · ')) + '</div>' : '') +
      (r.locked ? '' : '<button class="mv" data-act="move" data-week="' + w.week + '" data-key="' + r.key + '">העבר יום</button>') +
      '</article>';
  }

  // ---------- מסך חודש ----------
  function viewMonth() {
    if (!st.month) { var f = S.findWeek(st.weeks, st.today).week.weekStart; st.month = f.slice(0, 7); if (st.today.slice(0, 7) >= st.weeks[0].weekStart.slice(0, 7)) st.month = st.today.slice(0, 7); }
    var h = '<main class="month"><div class="seg"><button data-act="mview" data-v="grid" class="' + (st.monthView === 'grid' ? 'on' : '') + '">לוח שנה</button>' +
      '<button data-act="mview" data-v="road" class="' + (st.monthView === 'road' ? 'on' : '') + '">מפת דרכים</button></div>';
    h += st.monthView === 'grid' ? monthGrid() : roadmap();
    return h + legend() + '</main>';
  }
  function monthGrid() {
    var y = +st.month.slice(0, 4), m = +st.month.slice(5, 7);
    var first = st.month + '-01';
    var dow = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7; // שני=0
    var start = S.addDays(first, -dow);
    var firstWeekMonth = st.weeks[0].weekStart.slice(0, 7), lastWeekMonth = st.weeks[st.weeks.length - 1].weekStart.slice(0, 7);
    var byDate = {};
    st.weeks.forEach(function (w) { sched[w.week].runs.forEach(function (r) { if (r.date) (byDate[r.date] = byDate[r.date] || []).push({ w: w, r: r }); }); });
    var h = '<div class="mnav"><button class="nav" data-act="mprev" ' + (st.month <= firstWeekMonth ? 'disabled' : '') + '>→</button><h2>' + MONTHS[m - 1] + ' ' + y + '</h2>' +
      '<button class="nav" data-act="mnext" ' + (st.month >= lastWeekMonth ? 'disabled' : '') + '>←</button></div>';
    h += '<div class="grid"><div class="gh wk">שבוע</div>' + S.DAYS.map(function (d) { return '<div class="gh">' + d.slice(0, 3) + '</div>'; }).join('');
    for (var row = 0; row < 6; row++) {
      var ws = S.addDays(start, row * 7);
      if (row >= 4 && ws.slice(0, 7) > st.month) break;
      var wk = weekByStart(ws);
      h += '<div class="gw ' + (wk ? PERIOD_CLASS(wk.period) : '') + '">' + (wk ? '<b>' + wk.week + '</b><small>' + esc(wk.period.slice(0, 5)) + '</small><small class="km">' + fmtKm(weekDoneKm(wk)) + '/' + esc(wk.kmPlanned || firstNum(wk.kmText) || '') + '</small>' : '') + '</div>';
      for (var i = 0; i < 7; i++) {
        var d = S.addDays(ws, i), items = byDate[d] || [];
        var cls = 'gd' + (d.slice(0, 7) !== st.month ? ' out' : '') + (d === st.today ? ' today' : '') + (d === CFG.MARATHON_DATE ? ' marathon' : '') +
          (items.some(function (x) { return x.r.type === 'test' || x.r.type === 'race'; }) ? ' big' : '');
        h += '<button class="' + cls + '" ' + (items.length ? 'data-act="day" data-date="' + d + '"' : 'disabled') + '><span class="dn">' + dayOfMonth(d) + '</span>' +
          items.map(function (x) {
            var l = logOf(x.w.week, x.r);
            return '<i class="pill t-' + x.r.type + '">' + (l && l.status === 'done' ? '✓' : l && l.status === 'partial' ? '◐' : (x.r.type === 'race' ? '🏁' : '')) + '</i>';
          }).join('') + '</button>';
      }
    }
    return h + '</div>';
  }
  function roadmap() {
    var max = 0;
    st.weeks.forEach(function (w) { max = Math.max(max, w.kmPlanned || firstNum(w.kmText)); });
    var cur = S.findWeek(st.weeks, st.today).week.week;
    return '<div class="road">' + st.weeks.map(function (w) {
      var km = w.kmPlanned || firstNum(w.kmText), done = weekDoneKm(w);
      return '<button class="rw ' + PERIOD_CLASS(w.period) + (w.week === cur ? ' cur' : '') + '" data-act="gotoweek" data-week="' + w.week + '">' +
        '<span class="n">' + w.week + '</span><span class="track"><i class="plan" style="width:' + Math.round(km / max * 100) + '%"></i>' +
        '<i class="act" style="width:' + Math.round(done / max * 100) + '%"></i></span><span class="k">' + ltr(w.kmText) + '</span></button>';
    }).join('') + '<p class="hint">כל שורה היא שבוע. הפס הבהיר הוא המתוכנן, הכהה מה שבוצע. לחיצה פותחת את השבוע.</p></div>';
  }

  // ---------- הגדרות ----------
  function viewSettings() {
    return '<main class="settings"><h2>הגדרות</h2><div class="card"><div class="lbl">אני</div><div class="val">' + esc(st.athlete) + ' · ' + esc(plan()) + '</div>' +
      '<button class="ghost" data-act="switch">החלף שם</button></div>' +
      '<div class="card"><div class="lbl">מקרא</div>' + legend() + '<div class="steplg"><span class="s-warmup">חימום</span><span class="s-main">סט מרכזי</span><span class="s-cooldown">שחרור</span></div></div>' +
      '<div class="card"><div class="lbl">הזזות אישיות</div><div class="val">' + st.moves.filter(function (x) { return x['שם'] === st.athlete; }).length + ' שינויים</div></div>' +
      (CFG.SAMPLE ? '<div class="card note">מצב דוגמה: הנתונים מקובץ מקומי, והיומן (✓) מדומה.</div>' : '') + '</main>';
  }

  // ---------- כרטיס אימון ----------
  function runCard(w, r) {
    var date = r.date;
    var l = logOf(w.week, r);
    var h = '<div class="rcard t-' + r.type + '"><div class="rchead">' + chip(r.type) +
      '<div class="rct">' + S.RUN_LABELS[r.key] + (r.locked ? ' ' + LOCK : '') + '</div>' +
      '<div class="rcd">' + esc(r.day) + (date ? ' · ' + dm(date) : '') + '</div>' + check(l) + '</div>';
    if (r.total || r.km !== null) h += '<div class="rctot">' + ltr(r.total || runKmLabel(r)) + '</div>';
    if (r.intro) h += '<div class="rcintro">' + linkTerms(r.intro) + '</div>';
    r.steps.forEach(function (s) {
      h += '<div class="step s-' + s.kind + '"><div class="sk">' + (s.label ? s.label : KIND[s.kind]) + '</div><div class="sb"><div class="stext">' + linkTerms(s.text) + '</div>';
      s.sub.forEach(function (x) { h += '<div class="ssub">' + linkTerms(x) + '</div>'; });
      s.rec.forEach(function (x) { h += '<div class="srec">↳ ' + linkTerms(x) + '</div>'; });
      s.notes.forEach(function (x) { h += '<div class="snote">' + esc(x) + '</div>'; });
      h += '</div></div>';
    });
    if (r.warnings.length) h += '<div class="warn">⚠ ' + esc(r.warnings.join(' · ')) + '</div>';
    if (!r.locked) h += '<button class="ghost" data-act="move" data-week="' + w.week + '" data-key="' + r.key + '">העבר ליום אחר</button>';
    else h += '<div class="lockn">' + LOCK + ' אימון קבוצתי – לא ניתן להזיז</div>';
    return h + '</div>';
  }

  // ---------- חלון תחתון ----------
  function openSheet(html) {
    var el = $('#sheet'); el.innerHTML = '<div class="back" data-act="close"></div><div class="panel"><button class="x" data-act="close" aria-label="סגור">✕</button>' + html + '</div>';
    el.hidden = false; document.body.classList.add('noscroll');
  }
  function closeSheet() { $('#sheet').hidden = true; document.body.classList.remove('noscroll'); }
  function findRun(weekNo, key) { return sched[weekNo].runs.filter(function (r) { return r.key === key; })[0]; }

  function openMove(weekNo, key) {
    var w = weekByNo(weekNo), r = findRun(weekNo, key);
    var check = S.canMove(key, r.day, st.days);
    if (!check.ok) { openSheet('<p>' + esc(check.error) + '</p>'); return; }
    var orig = S.scheduleWeek(w, { days: st.days, personal: {} }).runs.filter(function (x) { return x.key === key; })[0].day;
    var h = '<h3>להעביר את ' + S.RUN_LABELS[key] + ' (' + TYPE[r.type].name + ') ליום…</h3><div class="dpick">';
    S.DAYS.forEach(function (d, i) {
      h += '<button class="' + (d === r.day ? 'on' : '') + '" data-act="moveto" data-week="' + weekNo + '" data-key="' + key + '" data-day="' + d + '"><b>' + d + '</b><span>' + (w.weekStart ? dm(S.addDays(w.weekStart, i)) : '') +
        '</span>' + (d === orig ? '<small>מקורי</small>' : '') + '</button>';
    });
    openSheet(h + '</div><p class="hint">ההזזה משפיעה רק על התצוגה שלך. אפשר שתי ריצות באותו יום.</p>');
  }
  // מוסיף שורת הזזה: מיד במסך, ובשיט ברקע. אם השמירה נכשלה – מחזירים ומסבירים
  function pushMove(row) {
    st.moves.push(row);
    if (CFG.SAMPLE) { lsSet('moves', st.moves); return; }
    apiPost({ action: 'move', name: row['שם'], week: row['שבוע'], run: row['ריצה'], day: row['יום'] }).then(function (res) {
      if (!res.ok) throw new Error(res.error);
      lsSet('planCache:' + st.athlete, null);
    }).catch(function (err) {
      var i = st.moves.indexOf(row); if (i >= 0) st.moves.splice(i, 1);
      recompute(); render();
      alert(err.message && !/fetch|Failed|Network/i.test(err.message) ? err.message : 'לא הצלחתי לשמור את ההזזה. בדוק חיבור ונסה שוב.');
    });
  }
  function doMove(weekNo, key, day) {
    var c = S.canMove(key, day, st.days);
    if (!c.ok) { alert(c.error); return; }
    pushMove({ 'שם': st.athlete, 'תכנית': plan(), 'שבוע': weekNo, 'ריצה': key, 'יום': day });
    recompute(); buildLog(); closeSheet(); render();
  }
  function resetWeek() {
    var w = weekNo();
    sched[w].runs.forEach(function (r) { if (r.source === 'personal') pushMove({ 'שם': st.athlete, 'תכנית': plan(), 'שבוע': w, 'ריצה': r.key, 'יום': '' }); });
    recompute(); buildLog(); render();
  }
  function weekNo() { return st.weekNo; }

  function openTerm(topic) {
    var row = st.settings.filter(function (x) { return x.topic === topic; })[0];
    if (!row) return;
    var el = $('#sheet .panel');
    var old = $('#sheet .gloss'); if (old) old.remove();
    var g = document.createElement('div'); g.className = 'gloss';
    g.innerHTML = '<b>' + esc(row.topic) + '</b><p>' + esc(row.rule) + '</p>';
    el.insertBefore(g, el.children[1]);
  }

  // ---------- ציור ראשי ----------
  function render() {
    var app = $('#app');
    if (!st.athlete || !plan()) { app.innerHTML = st.athletes.length ? viewPick() : '<main class="pick"><div class="hero-sun"></div><h1>מרתון תל אביב</h1><p class="sub">טוען…</p></main>'; return; }
    if (!st.weeks.length) {
      app.innerHTML = '<main class="pick"><div class="hero-sun"></div><h1>מרתון תל אביב</h1><p class="sub">' + (st.error ? esc(st.error) : 'טוען את התכנית…') + '</p>' +
        (st.error ? '<div class="names"><button class="name" data-act="retry">נסה שוב</button><button class="ghost" data-act="switch">החלף שם</button></div>' : '') + '</main>';
      return;
    }
    var body = st.screen === 'week' ? viewWeek() : st.screen === 'month' ? viewMonth() : viewSettings();
    app.innerHTML = body + '<nav class="tabs">' + [['week', 'בית', '⌂'], ['month', 'חודש', '▦'], ['settings', 'הגדרות', '⚙']].map(function (t) {
      return '<button data-act="tab" data-t="' + t[0] + '" class="' + (st.screen === t[0] ? 'on' : '') + '"><i>' + t[2] + '</i>' + t[1] + '</button>';
    }).join('') + '</nav>';
  }

  function shiftWeek(d) {
    var i = st.weeks.indexOf(weekByNo(st.weekNo)) + d;
    if (i < 0 || i >= st.weeks.length) return;
    st.weekNo = st.weeks[i].week; render(); window.scrollTo(0, 0);
  }

  // ---------- אירועים ----------
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var a = el.dataset.act, d = el.dataset;
    if (a === 'term') { e.stopPropagation(); openTerm(d.topic); return; }
    if (a === 'mv' || (a === 'open' && e.target.closest('[data-act="move"]'))) return;
    switch (a) {
      case 'pick': st.athlete = d.name; lsSet('athlete', st.athlete); st.weekNo = null; st.weeks = []; loadData(); render(); break;
      case 'retry': loadData(); render(); break;
      case 'switch': st.athlete = null; lsSet('athlete', null); st.weekNo = null; st.weeks = []; render(); break;
      case 'tab': st.screen = d.t; lsSet('screen', st.screen); render(); window.scrollTo(0, 0); break;
      case 'prev': shiftWeek(-1); break;
      case 'next': shiftWeek(1); break;
      case 'open': openSheet(runCard(weekByNo(+d.week), findRun(+d.week, d.key))); break;
      case 'move': e.stopPropagation(); openMove(+d.week, d.key); break;
      case 'moveto': doMove(+d.week, d.key, d.day); break;
      case 'resetweek': resetWeek(); break;
      case 'close': closeSheet(); break;
      case 'mview': st.monthView = d.v; render(); break;
      case 'mprev': case 'mnext': {
        var y = +st.month.slice(0, 4), m = +st.month.slice(5, 7) + (a === 'mnext' ? 1 : -1);
        if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
        st.month = y + '-' + (m < 10 ? '0' : '') + m; render(); break;
      }
      case 'gotoweek': st.weekNo = +d.week; st.screen = 'week'; lsSet('screen', 'week'); render(); window.scrollTo(0, 0); break;
      case 'day': {
        var date = d.date, html = '';
        st.weeks.forEach(function (w) { sched[w.week].runs.forEach(function (r) { if (r.date === date) html += runCard(w, r); }); });
        openSheet('<div class="dsheet-h">' + S.DAYS[(new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7] + ' · ' + dm(date) + '</div>' + html);
        break;
      }
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

  // החלקה בין שבועות (RTL: החלקה ימינה = שבוע קודם)
  var tx = null, ty = null, lp = null;
  document.addEventListener('touchstart', function (e) {
    var t = e.touches[0]; tx = t.clientX; ty = t.clientY;
    var r = e.target.closest('[data-lp]');
    if (r) lp = setTimeout(function () { lp = null; if (r.dataset.week) { var b = r.querySelector('.mv'); if (b) openMove(+r.dataset.week, r.dataset.key); } }, 550);
  }, { passive: true });
  document.addEventListener('touchmove', function () { if (lp) { clearTimeout(lp); lp = null; } }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (lp) { clearTimeout(lp); lp = null; }
    if (tx === null || st.screen !== 'week' || !$('#sheet').hidden || !$('#weekMain')) return;
    var t = e.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty; tx = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) shiftWeek(dx > 0 ? -1 : 1);
  }, { passive: true });

  // ---------- התחלה ----------
  if (st.athlete && plan()) loadData();
  render();
  loadAthletes();
  window.__app = { st: st, render: render };
})();
