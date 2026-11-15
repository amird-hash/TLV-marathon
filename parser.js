/* parser.js – פירוק טקסט אימון לשלבים. פונקציות טהורות, בלי תלות בדפדפן.
 *
 * parseCell(text) → {
 *   steps: [{ kind:'warmup'|'main'|'cooldown', text, sub:[], notes:[], rec:[], label? }],
 *   intro: string|null,   // טקסט שלפני השלבים (למשל "טסט 5K 🎯")
 *   total: string|null,   // "12 ק״מ"
 *   km: number|null,
 *   optional: boolean,
 *   empty?: true
 * }
 * עיקרון: הפארסר לעולם לא מאבד טקסט. אם לא בטוחים – הכול נכנס ל-main.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Parser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY_WORDS = 'ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת';
  var DAY_PREFIX_RE = new RegExp('^(' + DAY_WORDS + ')\\s*:\\s*');
  var DAY_DATE_RE = new RegExp('(' + DAY_WORDS + ')\\s+\\d{1,2}\\.\\d{1,2}\\.\\d{2,4}');

  // ---------- נרמול ----------
  function normalize(t) {
    if (t === null || t === undefined) return '';
    return String(t)
      .replace(/\r/g, '')
      .replace(/\\\*/g, '*')
      .replace(/\\~/g, '~')
      .replace(/([֐-׿])"([֐-׿])/g, '$1״$2') // ק"מ → ק״מ
      .replace(/(\d)\s*\*\s*(\d)/g, '$1×$2')                      // 4*800 → 4×800
      .replace(/[ \t ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  function isEmpty(t) { return t === '' || /^[-–—]+$/.test(t); }
  function stripDash(v) { return v.replace(/^[-–—]\s*/, '').trim(); }
  function oneLine(v) { return v.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim(); }

  // ---------- יום כתוב בתוך התא ----------
  // מחזיר {day, text}. text = הטקסט בלי הקידומת "שבת :".
  function detectDay(t) {
    var m = DAY_PREFIX_RE.exec(t);
    if (m) return { day: m[1], text: t.slice(m[0].length).trim() };
    m = DAY_DATE_RE.exec(t);
    if (m) return { day: m[1], text: t };
    return { day: null, text: t };
  }

  // ---------- הערות "אם הטסט תומך" ----------
  function extractNotes(seg) {
    var notes = [];
    var out = seg.replace(/\(\s*(אם\s[^()]*?תומך[^()]*)\)/g, function (_, g) {
      notes.push(g.trim());
      return '';
    });
    out = out.replace(/\s{2,}/g, ' ').replace(/\s+([,;])/g, '$1').trim();
    return { text: out, notes: notes };
  }

  // ---------- פירוק ערך של שלב ----------
  function parseStep(value, kind) {
    var segs = [];
    value.split('\n').forEach(function (line) {
      line.split('•').forEach(function (p) { p = p.trim(); if (p) segs.push(p); });
    });
    var notes = [], items = [];
    segs.forEach(function (s) {
      if (/^בכל מקרה/.test(s)) { notes.push(s); return; }
      var r = extractNotes(s);
      r.notes.forEach(function (n) { notes.push(n); });
      if (r.text) items.push(r.text);
    });
    var first = items.shift() || '';
    var parts = first.split(/\s*;\s*/).filter(Boolean);
    return { kind: kind, text: parts.shift() || '', sub: items, notes: notes, rec: parts };
  }

  // ---------- ק״מ ----------
  function simpleKm(text) {
    var m = /^(\d+(?:\.\d+)?)\s*(.*)$/.exec(text);
    if (!m) return null;
    var rest = m[2].replace(/\([^)]*\)/g, '')
      .replace(/ק״מ|קל|התאוששות|אופציונלי/g, '').replace(/\s+/g, '');
    return rest === '' ? parseFloat(m[1]) : null;
  }
  function stepKm(s) {
    var v = simpleKm(s.text);
    if (v !== null) return v;
    if (s.kind !== 'main' && /שנ׳|מתגברות/.test(s.text) && !/ק״מ/.test(s.text)) return 0;
    return null;
  }
  function computeKm(steps, total) {
    if (total) {
      var m = /(\d+(?:\.\d+)?)/.exec(total);
      return m ? parseFloat(m[1]) : null;
    }
    if (!steps.length) return null;
    var sum = 0;
    for (var i = 0; i < steps.length; i++) {
      var k = stepKm(steps[i]);
      if (k === null) return null;
      sum += k;
    }
    return sum;
  }

  // ---------- פורמט A: חימום: / סט מרכזי: / שחרור: / סה״כ: ----------
  function parseLabeled(t) {
    var re = /(חימום|סט מרכזי|שחרור|סה״כ)\s*:/g, m, marks = [];
    while ((m = re.exec(t))) marks.push({ name: m[1], start: m.index, end: re.lastIndex });
    var intro = t.slice(0, marks[0].start).trim();
    var steps = [], total = null;
    marks.forEach(function (mk, i) {
      var raw = t.slice(mk.end, i + 1 < marks.length ? marks[i + 1].start : t.length).trim();
      var v = stripDash(raw);
      if (!v) return;
      if (mk.name === 'סה״כ') { total = oneLine(v); return; }
      var kind = mk.name === 'חימום' ? 'warmup' : mk.name === 'שחרור' ? 'cooldown' : 'main';
      steps.push(parseStep(v, kind));
    });
    return { steps: steps, intro: intro ? oneLine(intro) : null, total: total };
  }

  // ---------- פורמט B: חופשי ----------
  var INLINE_RE = /^(?:(\d+(?:\.\d+)?)\s*ק״מ\s*)?(עם איכות)\s*:\s*חימום\s+([^,]+),\s*(.+),\s*שחרור\s+(.+)$/;

  function parseFree(t) {
    var steps = [];
    var im = INLINE_RE.exec(oneLine(t));
    if (im) {
      steps.push(parseStep(im[3], 'warmup'));
      steps.push(parseStep(im[4], 'main'));
      steps.push(parseStep(im[5], 'cooldown'));
      return { steps: steps, intro: im[2], total: im[1] ? im[1] + ' ק״מ' : null };
    }
    var warm = null, cool = null;
    var mw = /^(\d+(?:\.\d+)?)\s*(?:ק״מ)?\s*חימום(?=\s|$)/.exec(t);
    if (mw) { warm = mw[1] + ' ק״מ'; t = t.slice(mw[0].length).trim(); }
    var mc = /(?:^|\s)(\d+(?:\.\d+)?)\s*(?:ק״מ)?\s*שחרור\s*$/.exec(t);
    if (mc) { cool = mc[1] + ' ק״מ'; t = t.slice(0, mc.index).trim(); }
    if (warm) steps.push(parseStep(warm, 'warmup'));
    if (t) steps.push(parseStep(t, 'main'));
    if (cool) steps.push(parseStep(cool, 'cooldown'));
    return { steps: steps, intro: null, total: null };
  }

  // ---------- בוקר + ערב ----------
  function parseSplitDay(t) {
    var steps = [];
    t.split(/\s*\+\s*/).forEach(function (part) {
      var label = /\(בוקר\)/.test(part) ? 'בוקר' : /\(ערב\)/.test(part) ? 'ערב' : null;
      var s = parseStep(part.replace(/\((?:בוקר|ערב)\)/, '').trim(), 'main');
      s.label = label;
      steps.push(s);
    });
    return { steps: steps, intro: null, total: null };
  }

  // ---------- הפונקציה הראשית ----------
  function parseCell(raw) {
    var t = normalize(raw);
    var res = { steps: [], intro: null, total: null, km: null, optional: false };
    if (isEmpty(t)) { res.empty = true; return res; }

    var totalPre = null;
    var tp = /^(\d+(?:\.\d+)?):(?=\s|$)/.exec(t);
    if (tp) { totalPre = tp[1] + ' ק״מ'; t = t.slice(tp[0].length).trim(); }

    var p;
    if (/(?:חימום|סט מרכזי)\s*:/.test(t)) p = parseLabeled(t);
    else if (/\(בוקר\)/.test(t) && /\(ערב\)/.test(t)) p = parseSplitDay(t);
    else p = parseFree(t);

    res.steps = p.steps.filter(function (s) { return s.text || s.sub.length || s.notes.length || s.rec.length; });
    res.intro = p.intro;
    res.total = totalPre || p.total;
    res.optional = /אופציונלי/.test(t);
    if (!res.steps.length && !res.total && !res.intro) { res.empty = true; return res; }
    res.km = computeKm(res.steps, res.total);
    return res;
  }

  // ---------- סוג ריצה ----------
  function stepsText(parsed) {
    var parts = [parsed.intro || ''];
    parsed.steps.forEach(function (s) {
      parts.push(s.text, s.sub.join(' '), s.rec.join(' '));
    });
    return parts.join(' ');
  }
  // key: r1 | r2 | r3 | r4 | r5
  function classify(key, parsed) {
    var s = stepsText(parsed);
    if (/אליפטי|קליסטניקס|כוח/.test(s)) return 'cross';
    if (/מרתון תל אביב/.test(s)) return 'race';
    if (/טסט/.test(s)) return 'test';
    if (/מ[י]?רוץ/.test(s)) return 'race';
    if (key === 'r2') return 'quality';
    if (key === 'r5') return 'long';
    if ((key === 'r3' || key === 'r4') && /התאוששות/.test(s)) return 'recovery';
    return 'easy';
  }

  // ---------- פיצול תא "ריצות 3-4" ----------
  function splitRuns34(raw) {
    var t = normalize(raw);
    if (isEmpty(t)) return [];
    var re = /ריצה\s*([34])\s*:/g, m, marks = [];
    while ((m = re.exec(t))) marks.push({ key: 'r' + m[1], start: m.index, end: re.lastIndex });
    if (!marks.length) return [{ key: 'r3', text: t }];
    var out = [];
    marks.forEach(function (mk, i) {
      var txt = t.slice(mk.end, i + 1 < marks.length ? marks[i + 1].start : t.length).trim();
      if (!isEmpty(txt)) out.push({ key: mk.key, text: txt });
    });
    return out;
  }

  // ---------- ריצה אחת: פירוק + סוג + יום כתוב ----------
  function parseRun(raw, key) {
    var t = normalize(raw);
    var d = detectDay(t);
    var parsed = parseCell(d.text);
    if (parsed.empty) return null;
    parsed.key = key;
    parsed.raw = raw;
    parsed.dayExplicit = d.day;
    parsed.type = classify(key, parsed);
    return parsed;
  }

  // ---------- עזר לבדיקת "אין אובדן טקסט" ----------
  var STRUCT_WORDS = { 'חימום': 1, 'סט': 1, 'מרכזי': 1, 'שחרור': 1, 'סה״כ': 1, 'בוקר': 1, 'ערב': 1 };
  function tokens(s) {
    return (String(s).match(/[֐-׿A-Za-z0-9]+/g) || []).filter(function (w) { return !STRUCT_WORDS[w]; });
  }
  function outputTokens(parsed) {
    var parts = [parsed.intro || '', parsed.total || ''];
    parsed.steps.forEach(function (s) {
      parts.push(s.text, s.label || '');
      s.sub.forEach(function (x) { parts.push(x); });
      s.notes.forEach(function (x) { parts.push(x); });
      s.rec.forEach(function (x) { parts.push(x); });
    });
    return tokens(parts.join(' '));
  }
  // מחזיר רשימת טוקנים שאבדו (ריק = תקין)
  function lostTokens(sourceText, parsed) {
    var src = tokens(normalize(sourceText).replace(/\((?:בוקר|ערב)\)/g, ''));
    var counts = {};
    outputTokens(parsed).forEach(function (w) { counts[w] = (counts[w] || 0) + 1; });
    var lost = [];
    src.forEach(function (w) {
      if (counts[w] > 0) counts[w]--; else lost.push(w);
    });
    return lost;
  }

  return {
    normalize: normalize,
    detectDay: detectDay,
    parseCell: parseCell,
    parseRun: parseRun,
    splitRuns34: splitRuns34,
    classify: classify,
    lostTokens: lostTokens,
    DAY_WORDS: DAY_WORDS.split('|')
  };
});
