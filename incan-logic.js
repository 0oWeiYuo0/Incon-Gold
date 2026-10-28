// incan-logic.js — 印加寶藏的純規則邏輯（不依賴 Firebase，可以單獨測試）
//
// 牌的編碼：寶石 "T7"、神器 "A5"、危險 "Hsnake"
// 資料庫裡的清單（路徑、移除的危險牌、牌堆）都存成用逗號分隔的字串。

export const ROUNDS = 5;
export const MIN_PLAYERS = 2;   // 正式規則是 3～8 人，這裡放寬到 2 人方便測試
export const MAX_PLAYERS = 8;

export const HAZARD_KINDS = ["snake", "spider", "rockfall", "fire", "mummy"];
export const HAZARD_NAMES = { snake: "毒蛇", spider: "蜘蛛", rockfall: "落石", fire: "火焰", mummy: "木乃伊" };
export const TREASURE_VALUES = [1, 2, 3, 4, 5, 5, 7, 7, 9, 11, 11, 13, 14, 15, 17];
// 第 N 輪加進牌堆的神器分數。若跟你手上的實體版不同，改這一行就好。
export const ARTIFACT_VALUES = [5, 7, 8, 10, 12];

// ---------- 小工具 ----------
export const splitList = (s) => (s ? String(s).split(",").filter(Boolean) : []);
export const joinList = (a) => a.join(",");
const clone = (x) => JSON.parse(JSON.stringify(x));

export function parseCard(code) {
  const t = code[0];
  const rest = code.slice(1);
  if (t === "T") return { type: "T", value: Number(rest) };
  if (t === "A") return { type: "A", value: Number(rest) };
  return { type: "H", kind: rest };
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 每一輪的牌堆：15 張寶石 + 危險牌（每種 3 張，扣掉已被移除的）+ 本輪的 1 張神器
export function buildRoundDeck(removed, round, rng = Math.random) {
  const cards = TREASURE_VALUES.map((v) => "T" + v);
  for (const k of HAZARD_KINDS) {
    const gone = removed.filter((c) => c === "H" + k).length;
    for (let i = 0; i < 3 - gone; i++) cards.push("H" + k);
  }
  cards.push("A" + ARTIFACT_VALUES[round - 1]);
  return shuffle(cards, rng);
}

export function inCaveIds(state) {
  return Object.entries(state.players)
    .filter(([, p]) => p.inCave)
    .sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0]))
    .map(([id]) => id);
}

// ---------- 翻牌 ----------
// 回傳 true 代表本輪因此結束
function drawCard(state, deck, log) {
  if (deck.length === 0) {
    log.push("牌堆用完了，本輪結束。");
    return true;
  }
  const card = deck.shift();
  const c = parseCard(card);
  const ids = inCaveIds(state);

  if (c.type === "T") {
    const share = Math.floor(c.value / ids.length);
    for (const id of ids) state.players[id].hand += share;
    const left = c.value - share * ids.length;
    state.pathGems += left;
    state.path.push(card);
    log.push(`翻出寶石 ${c.value}：${ids.length} 位探險者各拿 ${share} 顆，路上留下 ${left} 顆。`);
    return false;
  }

  if (c.type === "A") {
    state.path.push(card);
    log.push(`翻出神器（${c.value} 分）。只有「單獨一人」回營地才能帶走。`);
    return false;
  }

  // 危險牌
  const name = HAZARD_NAMES[c.kind];
  if (state.path.includes(card)) {
    for (const id of ids) state.players[id].hand = 0;
    state.removed.push(card);
    log.push(`又翻出「${name}」！還在洞穴裡的人手上的寶石全部掉光，本輪結束。`);
    return true;
  }
  state.path.push(card);
  log.push(`翻出危險：${name}（再出現一次就糟了）。`);
  return false;
}

function beginRound(state, rng, log) {
  state.path = [];
  state.pathGems = 0;
  for (const p of Object.values(state.players)) {
    p.hand = 0;
    p.inCave = true;
  }
  const deck = buildRoundDeck(state.removed, state.round, rng);
  log.push(`—— 第 ${state.round} 輪開始 ——`);
  drawCard(state, deck, log); // 第一張牌不可能結束本輪
  return deck;
}

function nextRound(state, rng, log) {
  if (state.round >= ROUNDS) {
    state.phase = "over";
    log.push("—— 遊戲結束 ——");
    return [];
  }
  state.round += 1;
  return beginRound(state, rng, log);
}

// ---------- 對外的主要函式 ----------

// playersInfo: { uid: { name, order } }
export function newGame(playersInfo, rng = Math.random) {
  const state = {
    phase: "play", round: 1, turn: 1, needed: 0,
    path: [], pathGems: 0, removed: [], players: {}, reveal: null,
  };
  for (const [id, info] of Object.entries(playersInfo)) {
    state.players[id] = { name: info.name, order: info.order, tent: 0, artifacts: 0, hand: 0, inCave: true };
  }
  const log = [];
  const deck = beginRound(state, rng, log);
  state.needed = inCaveIds(state).length;
  state.reveal = { turn: 0, log: log.join("\n") };
  return { state, deck };
}

// choices: { uid: "stay" | "leave" }（沒填的人視為 stay）
export function resolveTurn(stateIn, deckIn, choices, rng = Math.random) {
  const state = clone(stateIn);
  const deck = deckIn.slice();
  const log = [];
  const ids = inCaveIds(state);
  const leavers = ids.filter((id) => choices[id] === "leave");

  const shown = {};
  for (const id of ids) shown[id] = choices[id] === "leave" ? "leave" : "stay";

  if (leavers.length > 0) {
    const share = Math.floor(state.pathGems / leavers.length);
    let artifactPts = 0;
    let artifactN = 0;
    if (leavers.length === 1) {
      const kept = [];
      for (const c of state.path) {
        if (c[0] === "A") { artifactPts += Number(c.slice(1)); artifactN++; } else kept.push(c);
      }
      state.path = kept;
    }
    for (const id of leavers) {
      const p = state.players[id];
      p.tent += p.hand + share;
      p.hand = 0;
      p.inCave = false;
    }
    state.pathGems -= share * leavers.length;
    const names = leavers.map((id) => state.players[id].name).join("、");
    log.push(`${names} 回營地了，分走路上的寶石（每人 ${share} 顆）。`);
    if (artifactN > 0) {
      const p = state.players[leavers[0]];
      p.tent += artifactPts;
      p.artifacts += artifactN;
      log.push(`${p.name} 是唯一回營地的人，帶走了 ${artifactN} 件神器（+${artifactPts} 分）！`);
    }
  } else {
    log.push("所有人都選擇繼續探險。");
  }

  let roundEnded;
  if (inCaveIds(state).length === 0) {
    roundEnded = true;
    log.push("所有探險者都回營地了，本輪結束。");
  } else {
    roundEnded = drawCard(state, deck, log);
  }

  let newDeck = deck;
  if (roundEnded) newDeck = nextRound(state, rng, log);

  state.turn += 1;
  state.needed = state.phase === "over" ? 0 : inCaveIds(state).length;
  state.reveal = { turn: stateIn.turn, choices: shown, log: log.join("\n") };
  return { state, deck: newDeck };
}

export function ranking(state) {
  return Object.entries(state.players)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => b.tent - a.tent || b.artifacts - a.artifacts || a.order - b.order);
}

// ---------- 與資料庫格式互轉 ----------
export function stateFromDb(v) {
  const players = {};
  for (const [id, p] of Object.entries(v.players || {})) {
    players[id] = {
      name: p.name, order: p.order, tent: p.tent || 0,
      artifacts: p.artifacts || 0, hand: p.hand || 0, inCave: !!p.inCave,
    };
  }
  return {
    phase: v.phase, round: v.round || 0, turn: v.turn || 0, needed: v.needed || 0,
    path: splitList(v.path), pathGems: v.pathGems || 0, removed: splitList(v.removed),
    players, reveal: v.reveal || null,
  };
}

export function stateToDb(state) {
  return {
    phase: state.phase, round: state.round, turn: state.turn, needed: state.needed,
    path: joinList(state.path), pathGems: state.pathGems, removed: joinList(state.removed),
    players: state.players, reveal: state.reveal,
  };
}

// 組成「一次寫入多個位置」的 update 物件
export function dbUpdates(code, state, deck) {
  const base = `incan/${code}/`;
  const u = {};
  for (const [k, v] of Object.entries(stateToDb(state))) u[base + k] = v;
  u[base + "ready"] = null;               // 清掉「已選擇」標記
  u[`incanChoices/${code}`] = null;       // 清掉上一回合的秘密選擇
  u[`incanSecret/${code}/deck`] = joinList(deck);
  return u;
}
