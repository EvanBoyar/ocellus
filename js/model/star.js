// STAR tallying: Score Then Automatic Runoff.
//
// Score round: sum every ballot's 0-5 score per candidate (blank
// counts as 0). The two highest totals advance. Runoff: each ballot
// casts one vote for whichever finalist it scored higher; equal
// scores express no preference. Ties are broken the way the STAR
// Voting Project recommends for simple elections: score-round ties by
// head-to-head preferences, runoff ties by score totals.
//
// Multi-winner races go through tallySeats, which awards seats either
// by Bloc STAR (STAR repeated, removing each winner; the group's
// overall favorites) or STAR-PR Allocated Score (proportional; each
// seat spends a quota of its supporters' ballot weight).

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

// Multi-winner tally. Reads race.seats (default 1) and race.method
// ('bloc' default, or 'pr'). Returns:
// { seats, method: 'star'|'bloc'|'pr', winners: [canonical indices in
//   seat order], rounds, tie, notes, ballotCount, quota? }
// One seat is always plain STAR regardless of method; the method only
// chooses how additional seats are awarded.
export function tallySeats(race, ballots) {
  const seats = Number.isInteger(race.seats) && race.seats > 1 ? race.seats : 1;
  if (seats === 1) {
    const r = tallyRace(race, ballots);
    return {
      seats: 1,
      method: 'star',
      winners: r.winner === null ? [] : [r.winner],
      rounds: [{ members: race.candidates.map((_, i) => i), result: r }],
      tie: r.tie,
      notes: r.notes,
      ballotCount: ballots.length,
    };
  }
  return race.method === 'pr'
    ? tallyAllocatedScore(race, ballots, seats)
    : tallyBloc(race, ballots, seats);
}

// Bloc STAR: plain STAR once per seat, removing each winner. Every
// round is hand-checkable with the same arithmetic as a single-winner
// race. Rounds keep tallyRace's shape in sub-index space; `members`
// maps a round's index i to the canonical candidate index.
function tallyBloc(race, ballots, seats) {
  const out = {
    seats, method: 'bloc', winners: [], rounds: [],
    tie: false, notes: [], ballotCount: ballots.length,
  };
  let remaining = race.candidates.map((_, i) => i);
  for (let seat = 0; seat < seats && remaining.length > 0; seat++) {
    const sub = { candidates: remaining.map((i) => race.candidates[i]) };
    const subBallots = ballots.map((b) => remaining.map((i) => b[i]));
    const r = tallyRace(sub, subBallots);
    out.rounds.push({ members: remaining.slice(), result: r });
    if (r.tie || r.winner === null) {
      out.tie = true;
      out.notes.push('Seat ' + (seat + 1)
        + ' is tied; later seats cannot be decided until it is resolved.');
      break;
    }
    const winner = remaining[r.winner];
    out.winners.push(winner);
    remaining = remaining.filter((i) => i !== winner);
  }
  return out;
}

// STAR-PR (Allocated Score): proportional seats. Each round the
// highest weighted score total takes a seat, then one quota of the
// ballots that scored that winner highest is spent, removing their
// influence over later seats. Ballot weights are exact BigInt
// fractions so two officials can never disagree by a rounding error.
// Round totals are also reported as floats for display.
function tallyAllocatedScore(race, ballots, seats) {
  const n = race.candidates.length;
  const out = {
    seats, method: 'pr', winners: [], rounds: [],
    tie: false, notes: [], ballotCount: ballots.length,
    quota: { ballots: ballots.length, seats },
  };
  if (n === 0 || ballots.length === 0) return out;

  // Unweighted stats for tie-breaking, same spirit as pickFinalists.
  const plainTotals = new Array(n).fill(0);
  const fiveStars = new Array(n).fill(0);
  const scoredBy = new Array(n).fill(0);
  for (const b of ballots) {
    for (let c = 0; c < n; c++) {
      const s = clampScore(b[c]);
      plainTotals[c] += s;
      if (s > 0) scoredBy[c] += 1;
      if (s === 5) fiveStars[c] += 1;
    }
  }

  const quota = rat(BigInt(ballots.length), BigInt(seats));
  let weights = ballots.map(() => rat(1n, 1n));
  let remaining = race.candidates.map((_, i) => i);

  for (let seat = 0; seat < seats && remaining.length > 0; seat++) {
    const totals = new Map(remaining.map((c) => [c, rat(0n, 1n)]));
    for (let bi = 0; bi < ballots.length; bi++) {
      if (weights[bi].n === 0n) continue;
      for (const c of remaining) {
        const s = clampScore(ballots[bi][c]);
        if (s > 0) totals.set(c, radd(totals.get(c), rmulInt(weights[bi], s)));
      }
    }
    let best = [];
    for (const c of remaining) {
      if (best.length === 0) { best = [c]; continue; }
      const cmp = rcmp(totals.get(c), totals.get(best[0]));
      if (cmp > 0) best = [c];
      else if (cmp === 0) best.push(c);
    }
    if (best.length > 1) {
      best.sort((a, b) => plainTotals[b] - plainTotals[a]
        || fiveStars[b] - fiveStars[a] || scoredBy[b] - scoredBy[a]);
      const [a, b] = best;
      if (plainTotals[a] === plainTotals[b] && fiveStars[a] === fiveStars[b]
          && scoredBy[a] === scoredBy[b]) {
        out.tie = true;
        out.notes.push('Seat ' + (seat + 1)
          + ' is tied between equally supported candidates.');
        out.rounds.push(prRound(remaining, totals, null));
        break;
      }
      out.notes.push('Seat ' + (seat + 1)
        + ' tie broken by unweighted score totals.');
    }
    const winner = best[0];
    out.winners.push(winner);
    out.rounds.push(prRound(remaining, totals, winner));
    remaining = remaining.filter((c) => c !== winner);
    if (seat < seats - 1) spendQuota(ballots, weights, winner, quota);
  }
  return out;
}

function prRound(members, totals, winner) {
  return {
    members: members.slice(),
    winner,
    // Display copies, rounded to 2 decimals; the count itself never
    // uses these.
    totals: members.map((c) => Math.round(rtoNumber(totals.get(c)) * 100) / 100),
  };
}

// Removes one quota of weight from the winner's supporters, strongest
// scores first. Supporters at the boundary score level are reduced
// fractionally so exactly a quota is spent. If the winner's whole
// support is under a quota, all of it is spent.
function spendQuota(ballots, weights, winner, quota) {
  let spent = rat(0n, 1n);
  for (let s = 5; s >= 1; s--) {
    const level = [];
    let levelWeight = rat(0n, 1n);
    for (let bi = 0; bi < ballots.length; bi++) {
      if (weights[bi].n === 0n) continue;
      if (clampScore(ballots[bi][winner]) === s) {
        level.push(bi);
        levelWeight = radd(levelWeight, weights[bi]);
      }
    }
    if (level.length === 0) continue;
    const room = rsub(quota, spent);
    if (rcmp(levelWeight, room) <= 0) {
      for (const bi of level) weights[bi] = rat(0n, 1n);
      spent = radd(spent, levelWeight);
      if (rcmp(spent, quota) === 0) return;
    } else {
      // keep = 1 - room / levelWeight of each ballot's weight
      const keep = rsub(rat(1n, 1n), rdiv(room, levelWeight));
      for (const bi of level) weights[bi] = rmul(weights[bi], keep);
      return;
    }
  }
}

// Exact fractions on BigInt, always reduced, denominator positive.
function bgcd(a, b) {
  a = a < 0n ? -a : a;
  while (b) [a, b] = [b, a % b];
  return a;
}

function rat(n, d) {
  if (d < 0n) { n = -n; d = -d; }
  const g = bgcd(n < 0n ? -n : n, d) || 1n;
  return { n: n / g, d: d / g };
}

function radd(a, b) { return rat(a.n * b.d + b.n * a.d, a.d * b.d); }
function rsub(a, b) { return rat(a.n * b.d - b.n * a.d, a.d * b.d); }
function rmul(a, b) { return rat(a.n * b.n, a.d * b.d); }
function rdiv(a, b) { return rat(a.n * b.d, a.d * b.n); }
function rmulInt(a, k) { return rat(a.n * BigInt(k), a.d); }
function rcmp(a, b) {
  const x = a.n * b.d;
  const y = b.n * a.d;
  return x < y ? -1 : x > y ? 1 : 0;
}
function rtoNumber(a) { return Number(a.n) / Number(a.d); }

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
