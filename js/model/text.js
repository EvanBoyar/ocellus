// Approximate text metrics for the ballot fonts, in millimeters.
//
// Ballots render with "Helvetica, Arial, sans-serif". Helvetica,
// Arial, and Liberation Sans (the usual Linux substitute) share the
// same advance widths, so the classic Helvetica AFM tables predict
// line widths closely on every platform we print from. Layout and
// render both use these numbers, so the space reserved for a line of
// text always matches what gets drawn into it.

// Advance widths per 1000 units of font size, for chars 32..126.
const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

function charUnits(code, bold) {
  if (code >= 32 && code <= 126) return (bold ? BOLD : REGULAR)[code - 32];
  // CJK and other full-width scripts are square glyphs.
  if (code >= 0x2e80) return 1000;
  // Accented Latin, Greek, Cyrillic: close to a typical letter.
  return bold ? 620 : 580;
}

// Width in mm of a string at the given font size in mm.
export function textWidth(str, size, bold) {
  let units = 0;
  for (const ch of String(str)) units += charUnits(ch.codePointAt(0), bold);
  return (units / 1000) * size;
}

// Trims a string so it fits maxWidth with '...' appended.
function truncateToFit(str, size, maxWidth, bold) {
  let s = str;
  while (s.length > 0 && textWidth(s + '...', size, bold) > maxWidth) {
    s = s.slice(0, -1);
  }
  return s + '...';
}

// Hard-breaks one oversized word into pieces that each fit maxWidth.
function breakWord(word, size, maxWidth, bold) {
  const pieces = [];
  let cur = '';
  for (const ch of word) {
    if (cur !== '' && textWidth(cur + ch, size, bold) > maxWidth) {
      pieces.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur !== '') pieces.push(cur);
  return pieces;
}

// Greedy word wrap. Returns at least one line (possibly ''). Words
// wider than maxWidth are broken mid-word. When maxLines is given,
// overflow is cut and the last kept line ends in '...'.
export function wrapLines(str, size, maxWidth, opts = {}) {
  const { bold = false, maxLines = 0 } = opts;
  const words = String(str).trim().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return [''];

  const lines = [];
  let cur = '';
  const push = (line) => lines.push(line);
  for (const word of words) {
    const cand = cur === '' ? word : cur + ' ' + word;
    if (textWidth(cand, size, bold) <= maxWidth) {
      cur = cand;
      continue;
    }
    if (cur !== '') push(cur);
    if (textWidth(word, size, bold) <= maxWidth) {
      cur = word;
    } else {
      const pieces = breakWord(word, size, maxWidth, bold);
      for (let i = 0; i < pieces.length - 1; i++) push(pieces[i]);
      cur = pieces[pieces.length - 1];
    }
  }
  if (cur !== '') push(cur);

  if (maxLines > 0 && lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = textWidth(last + '...', size, bold) <= maxWidth
      ? last + '...'
      : truncateToFit(last, size, maxWidth, bold);
    return kept;
  }
  return lines;
}
