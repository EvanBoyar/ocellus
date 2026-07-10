// STAR tallying: Score Then Automatic Runoff.
//
// Score round: sum every ballot's 0-5 score per candidate (blank
// counts as 0). The two highest totals advance. Runoff: each ballot
// casts one vote for whichever finalist it scored higher; equal
// scores express no preference. Ties are broken the way the STAR
// Voting Project recommends for simple elections: score-round ties by
// head-to-head preferences, runoff ties by score totals.

// `ballots` is an array of score arrays indexed by canonical
// candidate index; entries are integers 0-5 (missing/null = 0).
export function tallyRace(race, ballots) {
  const n = race.candidates.length;
  const totals = new Array(n).fill(0);
  const scoredBy = new Array(n).fill(0);
  for (const b of ballots) {
    for (let c = 0; c < n; c++) {
      const s = clampScore(b[c]);
      totals[c] += s;
      if (s > 0) scoredBy[c] += 1;
    }
  }

  const fiveStars = new Array(n).fill(0);
  for (const b of ballots) {
    for (let c = 0; c < n; c++) if (clampScore(b[c]) === 5) fiveStars[c] += 1;
  }

  const result = {
    totals,
    scoredBy,
    fiveStars,
    ballotCount: ballots.length,
    finalists: [],
    runoff: null,
    winner: null,
    tie: false,
    notes: [],
  };
  if (n === 0 || ballots.length === 0) return result;
  if (n === 1) {
    result.finalists = [0];
    result.winner = 0;
    return result;
  }

  const prefs = headToHead(n, ballots);
  const finalists = pickFinalists(totals, prefs, { fiveStars, scoredBy }, result.notes);
  if (!finalists) {
    // The second runoff seat is hopelessly tied. If the clear score
    // leader beats every tied contender head-to-head anyway, the tie
    // cannot change the outcome, so it is not a real tie.
    const order = totals.map((t, i) => ({ t, i })).sort((x, y) => y.t - x.t);
    const seated = order.filter((o) => o.t > order[1].t).map((o) => o.i);
    const pool = order.filter((o) => o.t === order[1].t).map((o) => o.i);
    const beats = (a, p) => prefs[a][p] > prefs[p][a]
      || (prefs[a][p] === prefs[p][a] && totals[a] > totals[p]);
    if (seated.length === 1 && pool.every((p) => beats(seated[0], p))) {
      result.finalists = [seated[0]];
      result.winner = seated[0];
      result.notes.push('Candidates tied for the second runoff spot, but every possible runoff ends the same way.');
      return result;
    }
    result.tie = true;
    result.notes.push('Unbreakable tie in the score round.');
    return result;
  }
  const [a, b] = finalists;
  result.finalists = [a, b];

  const forA = prefs[a][b];
  const forB = prefs[b][a];
  const noPref = ballots.length - forA - forB;
  result.runoff = { forA, forB, noPref };

  if (forA > forB) result.winner = a;
  else if (forB > forA) result.winner = b;
  else if (totals[a] > totals[b]) {
    result.winner = a;
    result.notes.push('Runoff tied; broken by higher score total.');
  } else if (totals[b] > totals[a]) {
    result.winner = b;
    result.notes.push('Runoff tied; broken by higher score total.');
  } else {
    result.tie = true;
    result.notes.push('Exact tie between finalists.');
  }
  return result;
}

function clampScore(s) {
  if (!Number.isInteger(s) || s < 0) return 0;
  return s > 5 ? 5 : s;
}

// prefs[i][j] = number of ballots scoring i strictly above j.
function headToHead(n, ballots) {
  const prefs = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const b of ballots) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const si = clampScore(b[i]);
        const sj = clampScore(b[j]);
        if (si > sj) prefs[i][j] += 1;
        else if (sj > si) prefs[j][i] += 1;
      }
    }
  }
  return prefs;
}

// Returns the two runoff entrants, or null on an unbreakable tie.
function pickFinalists(totals, prefs, stats, notes) {
  const order = totals
    .map((t, i) => ({ t, i }))
    .sort((x, y) => y.t - x.t);

  // Anyone with a total strictly above second place is seated
  // outright; everyone tied at the boundary competes for what's left.
  const seated = order.filter((o) => o.t > order[1].t).map((o) => o.i);
  const pool = order.filter((o) => o.t === order[1].t).map((o) => o.i);
  const fromPool = resolvePool(pool, 2 - seated.length, prefs, stats, notes);
  if (!fromPool) return null;
  return seated.concat(fromPool);
}

// Seats `count` candidates from a tied pool one at a time. Each round
// ranks the remaining pool by head-to-head wins within the pool, then
// by five-star ratings received, then by how many ballots scored the
// candidate at all. Returns null only when candidates are
// indistinguishable on every criterion.
function resolvePool(pool, count, prefs, stats, notes) {
  if (pool.length === count) return pool;
  if (count <= 0) return [];
  notes.push('Score-round tie resolved by head-to-head preferences.');
  const seated = [];
  let remaining = [...pool];
  while (seated.length < count) {
    const ranked = remaining.map((c) => [
      c,
      remaining.filter((o) => o !== c && prefs[c][o] > prefs[o][c]).length,
      stats.fiveStars[c],
      stats.scoredBy[c],
    ]).sort((x, y) => y[1] - x[1] || y[2] - x[2] || y[3] - x[3]);
    const top = ranked[0];
    const next = ranked[1];
    if (next && top[1] === next[1] && top[2] === next[2] && top[3] === next[3]) {
      return null;
    }
    seated.push(top[0]);
    remaining = remaining.filter((c) => c !== top[0]);
  }
  return seated;
}

// Yes/no question tally. `answers` entries are 1 (yes), 0 (no), or
// null (blank, excluded from the denominator).
export function tallyQuestion(question, answers) {
  let yes = 0;
  let no = 0;
  let blank = 0;
  for (const a of answers) {
    if (a === 1) yes += 1;
    else if (a === 0) no += 1;
    else blank += 1;
  }
  const voted = yes + no;
  const passed = voted > 0 && yes * question.den >= question.num * voted;
  return { yes, no, blank, passed };
}
