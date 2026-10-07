// Pixel art for the office, drawn from small character maps so the app ships no
// image files. Everything is authored at 1 px per cell and scaled up without
// smoothing by the office renderer.

export const TILE = 16;

const cache = new Map();

// Builds an offscreen canvas from rows of palette characters ('.' = transparent).
export function sprite(key, rows, palette) {
  if (cache.has(key)) return cache.get(key);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const c = palette[rows[y][x]];
      if (!c) continue;
      g.fillStyle = c;
      g.fillRect(x, y, 1, 1);
    }
  }
  cache.set(key, cv);
  return cv;
}

const flip = (rows) => rows.map((r) => [...r].reverse().join(''));

// ---- characters -------------------------------------------------------------
export const SKINS = ['#f2c9a2', '#e2ad84', '#c98c62', '#a9704c', '#8a5a3c', '#f6d6b8'];
export const HAIRS = ['#2b2118', '#5a3a26', '#111111', '#a3542d', '#d9a55c', '#8b8f9c', '#c74b3b', '#3a4b8f'];
export const SHIRTS = ['#e76f51', '#2a9d8f', '#4895ef', '#f4a261', '#9d79d6', '#ef476f', '#52b788', '#e9c46a', '#5c7cfa', '#ff8fab', '#f7f7f7', '#2f3e46'];
const PANTS = ['#2f3440', '#3d405b', '#4a4e69', '#264653', '#5c4033'];

function rnd(seed, salt) {
  let x = (seed ^ (salt * 0x9e3779b1)) >>> 0;
  x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
  return (x % 10000) / 10000;
}
const pick = (arr, seed, salt) => arr[Math.floor(rnd(seed, salt) * arr.length) % arr.length];

// 12 x 16 body, front view. H hair, S skin, E eye, T shirt, P pants, B shoes, G glasses.
const FRONT = [
  '....HHHH....',
  '...HHHHHH...',
  '..HHHHHHHH..',
  '..HSSSSSSH..',
  '..SSESSESS..',
  '..SSSSSSSS..',
  '...SSSSSS...',
  '..TTTTTTTT..',
  '.TTTTTTTTTT.',
  '.STTTTTTTTS.',
  '..TTTTTTTT..',
  '..PPPPPPPP..',
  '..PPP..PPP..',
  '..PPP..PPP..',
  '..BBB..BBB..',
  '............',
];
const BACK = FRONT.map((r, i) => (i === 4 ? '..HHHHHHHH..' : i === 3 ? '..HHHHHHHH..' : i === 5 ? '..HSSSSSSH..' : r));
const SIDE = [
  '....HHHH....',
  '...HHHHHH...',
  '...HHHHHHH..',
  '...HHSSSS...',
  '...HSSESS...',
  '...SSSSSS...',
  '....SSSS....',
  '...TTTTTT...',
  '...TTTTTTT..',
  '...TTTTTTS..',
  '...TTTTTT...',
  '...PPPPPP...',
  '...PPPPPP...',
  '...PPP.PP...',
  '...BBB.BB...',
  '............',
];
const HAIR_LONG = ['..HHHHHHHH..', '..HHHHHHHH..', '..HHHHHHHH..', '..HSSSSSSH..', '.HSSESSESSH.', '.HSSSSSSSSH.', '.H.SSSSSS.H.'];
const HAIR_BUN = ['....HHHH....', '...HHHHHH...', '.HHHHHHHHHH.', '..HSSSSSSH..'];

function hairStyle(rows, style) {
  if (style === 1) return rows.map((r, i) => (i < 7 ? HAIR_LONG[i] : r));
  if (style === 2) return rows.map((r, i) => (i < 4 ? HAIR_BUN[i] : r));
  if (style === 3) return rows.map((r, i) => (i === 0 ? '............' : i === 1 ? '....HHHH....' : i === 2 ? '..HHHHHHHH..' : r)); // short
  return rows;
}
function walkFrame(rows, n) {
  // lift one leg: blank one shoe row on alternating sides
  return rows.map((r, i) => {
    if (i === 14) return n === 1 ? '..BBB.......' : '.......BBB..';
    if (i === 13) return n === 1 ? '..PPP..PPP..' : '..PPP..PPP..';
    return r;
  });
}
function glasses(rows) { return rows.map((r, i) => (i === 4 ? r.replace(/E/g, 'G') : r)); }

export function characterSprites(seed) {
  const pal = { H: pick(HAIRS, seed, 1), S: pick(SKINS, seed, 2), E: '#1b1b1b', T: pick(SHIRTS, seed, 3), P: pick(PANTS, seed, 4), B: '#f2f2f2', G: '#1b1b1b' };
  const style = Math.floor(rnd(seed, 5) * 4);
  const specs = rnd(seed, 6) < 0.3;
  const base = (rows) => { let r = hairStyle(rows, style); if (specs) r = glasses(r); return r; };
  const key = (name) => `c${seed}:${name}`;
  const dirs = {
    down: base(FRONT), up: base(BACK), right: base(SIDE), left: flip(base(SIDE)),
  };
  const out = {};
  for (const [d, rows] of Object.entries(dirs)) {
    out[d] = [sprite(key(d + 0), rows, pal), sprite(key(d + 1), walkFrame(rows, 1), pal), sprite(key(d + 2), walkFrame(rows, 2), pal)];
  }
  // sitting: legs hidden behind the chair
  const sit = base(FRONT).map((r, i) => (i >= 12 ? '............' : r));
  out.sit = [sprite(key('sit'), sit, pal)];
  out.color = pal.T;
  return out;
}

// ---- furniture ----------------------------------------------------------------
const F = {
  w: '#f3efe6', d: '#2b2622', k: '#1b1816', s: '#dfe6ee', b: '#3b4a6b', m: '#6ea8ff', g: '#5ca457', G: '#2f7a3d', t: '#5a3a26', T: '#8a5a36',
  o: '#e1a96a', r: '#c44536', y: '#f2c94c', p: '#7b5cff', c: '#9aa4b2', e: '#7ad7c0', n: '#243b2f', l: '#e8d5b7', i: '#c7a27c', x: '#444',
};

// desk with monitor: 32 x 24 (2 tiles wide, 1.5 high)
export const DESK = sprite('desk', [
  '............kkkkkkkk............',
  '............kmmmmmmk............',
  '............kmmmmmmk............',
  '............kmmmmmmk............',
  '............kkkkkkkk............',
  '..............kkkk..............',
  '.TTTTTTTTTTTTTTTTTTTTTTTTTTTTTT.',
  'TTooooooooooooooooooooooooooooTT',
  'TooooooooooooookkkkkoooooooooooT',
  'ToooooooooooooooooooooowwooooooT',
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  '.tt..........................tt.',
  '.tt..........................tt.',
  '.tt..........................tt.',
  '................................',
], F);
export const DESK_WORK = sprite('desk-work', [
  '............kkkkkkkk............',
  '............keeeeeek............',
  '............kee.eeek............',
  '............keeeeeek............',
  '............kkkkkkkk............',
  '..............kkkk..............',
  '.TTTTTTTTTTTTTTTTTTTTTTTTTTTTTT.',
  'TTooooooooooooooooooooooooooooTT',
  'TooooooooooooookkkkkoooooooooooT',
  'ToooooooooooooooooooooowwooooooT',
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  '.tt..........................tt.',
  '.tt..........................tt.',
  '.tt..........................tt.',
  '................................',
], F);
export const CHAIR = sprite('chair', [
  '................',
  '....dddddddd....',
  '....dbbbbbbd....',
  '....dbbbbbbd....',
  '....dbbbbbbd....',
  '...dddddddddd...',
  '...dbbbbbbbbd...',
  '...dddddddddd...',
  '.......dd.......',
  '.....dddddd.....',
  '................',
], F);
export const PLANT = sprite('plant', [
  '......gg........',
  '....ggGGgg......',
  '...gGGggGGg.....',
  '..gGGgggGGGg....',
  '..gGGGgGGGgg....',
  '...ggGGGGgg.....',
  '.....gGGg.......',
  '......gg........',
  '.....TTTT.......',
  '....TooooT......',
  '....ToooooT.....',
  '.....TTTTT......',
], F);
export const SHELF = sprite('shelf', [
  'TTTTTTTTTTTTTTTT',
  'TrrpyyccrrmmTTTT',
  'TrrpyyccrrmmgggT',
  'TTTTTTTTTTTTTTTT',
  'TggyyrrppccyyTTT',
  'TggyyrrppccyyrrT',
  'TTTTTTTTTTTTTTTT',
  'TccmmggrryyppTTT',
  'TccmmggrryyppyyT',
  'TTTTTTTTTTTTTTTT',
  'tt............tt',
], F);
export const SOFA = sprite('sofa', [
  '.rrrrrrrrrrrrrrrrrrrrrrrrrrrrr..',
  'rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr.',
  'rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr.',
  'rrooooooooooooooooooooooooooorr.',
  'rrooooooooooooooooooooooooooorr.',
  'rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr.',
  'rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr.',
  '.tt..........................tt.',
], F);
export const BOARD = sprite('board', [
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  'TwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwT',
  'TwwbbbbbbwwwwwwwwwwwwwwwwwwwwwwT',
  'TwwwwwwwwwwwwwwrrrrrwwwwwwwwwwwT',
  'TwwbbbbbbbbbbwwwwwwwwwwwwwwwwwwT',
  'TwwwwwwwwwwwwwwwwwwwwwgggggggwwT',
  'TwwbbbbbwwwwwwwwwwwwwwwwwwwwwwwT',
  'TwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwT',
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
], F);
export const COFFEE = sprite('coffee', [
  '....kkkkkkkk....',
  '....kccccccck...',
  '....kcrrrrcck...',
  '....kccccccck...',
  '....kkkkkkkkk...',
  '....kk....kkk...',
  '....kk.ww.kkk...',
  '....kk.ww.kkk...',
  '....kkkkkkkkk...',
  '..llllllllllll..',
  '..llllllllllll..',
  '..ll........ll..',
], F);
export const COOLER = sprite('cooler', [
  '.....mmmmmm.....',
  '....mssssssm....',
  '....mssssssm....',
  '....mmmmmmmm....',
  '....cccccccc....',
  '....cccccccc....',
  '....cc.ee.cc....',
  '....cccccccc....',
  '....cccccccc....',
  '....cccccccc....',
  '....cccccccc....',
  '.....c....c.....',
], F);
export const RACK = sprite('rack', [
  'kkkkkkkkkkkkkkkk',
  'kxxxxxxxxxxxxxgk',
  'kxxxxxxxxxxxxxxk',
  'kkkkkkkkkkkkkkkk',
  'kxxxxxxxxxxxxxek',
  'kxxxxxxxxxxxxxxk',
  'kkkkkkkkkkkkkkkk',
  'kxxxxxxxxxxxxxgk',
  'kxxxxxxxxxxxxxxk',
  'kkkkkkkkkkkkkkkk',
  'kxxxxxxxxxxxxxrk',
  'kxxxxxxxxxxxxxxk',
  'kkkkkkkkkkkkkkkk',
], F);
export const TABLE = sprite('table', [
  '..TTTTTTTTTTTTTTTTTTTTTTTTTTT...',
  '.TiiiiiiiiiiiiiiiiiiiiiiiiiiiT..',
  '.TiiiiiiiiiiiiiiiiiiiiiiiiiiiT..',
  '.TiiiiiiiiiiiiiiiiiiiiiiiiiiiT..',
  '.TiiiiiiiiiiiiiiiiiiiiiiiiiiiT..',
  '.TiiiiiiiiiiiiiiiiiiiiiiiiiiiT..',
  '.TiiiiiiiiiiiiiiiiiiiiiiiiiiiT..',
  '.TiiiiiiiiiiiiiiiiiiiiiiiiiiiT..',
  '..TTTTTTTTTTTTTTTTTTTTTTTTTTT...',
  '..tt.......................tt...',
  '..tt.......................tt...',
], F);
export const RUG = sprite('rug', [
  'pppppppppppppppppppppppppppppppp',
  'pyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyp',
  'pyppppppppppppppppppppppppppppyp',
  'pyppppppppppppppppppppppppppppyp',
  'pyppppppppppppppppppppppppppppyp',
  'pyppppppppppppppppppppppppppppyp',
  'pyppppppppppppppppppppppppppppyp',
  'pyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyp',
  'pppppppppppppppppppppppppppppppp',
], F);
export const DOOR = sprite('door', [
  'TTTTTTTTTTTTTTTT',
  'TooooooTTooooooT',
  'ToooooyTTyoooooT',
  'TooooooTTooooooT',
  'TooooooTTooooooT',
  'TooooooTTooooooT',
  'TTTTTTTTTTTTTTTT',
], F);

// Catalogue: footprint in tiles, where the sprite sits, whether a worker can sit here.
export const ITEMS = {
  desk: { label: 'Masa', w: 2, h: 2, sprite: DESK, work: DESK_WORK, seat: { dx: 1, dy: 1 }, blocks: [[0, 0], [1, 0]] },
  plant: { label: 'Bitki', w: 1, h: 1, sprite: PLANT, blocks: [[0, 0]] },
  shelf: { label: 'Kitaplık', w: 1, h: 1, sprite: SHELF, blocks: [[0, 0]] },
  sofa: { label: 'Kanepe', w: 2, h: 1, sprite: SOFA, blocks: [[0, 0], [1, 0]] },
  board: { label: 'Tahta', w: 2, h: 1, sprite: BOARD, blocks: [[0, 0], [1, 0]] },
  coffee: { label: 'Kahve makinesi', w: 1, h: 1, sprite: COFFEE, blocks: [[0, 0]] },
  cooler: { label: 'Su sebili', w: 1, h: 1, sprite: COOLER, blocks: [[0, 0]] },
  rack: { label: 'Sunucu', w: 1, h: 1, sprite: RACK, blocks: [[0, 0]] },
  table: { label: 'Toplantı masası', w: 2, h: 1, sprite: TABLE, blocks: [[0, 0], [1, 0]] },
  rug: { label: 'Halı', w: 2, h: 1, sprite: RUG, blocks: [] },
};

// ---- floors -------------------------------------------------------------------
export const FLOORS = {
  checker: { a: '#9fb0bf', b: '#8ea0b0' },
  wood: { a: '#8b5a3c', b: '#7a4d33', planks: true },
  tile: { a: '#d8dfe4', b: '#c9d2d9', grout: '#b7c1c9' },
  dark: { a: '#262a34', b: '#1f232c' },
  carpet: { a: '#6b8f78', b: '#62866f', dots: '#587b65' },
  sand: { a: '#e0c9a6', b: '#d6bd98', dots: '#c9ad85' },
  lavender: { a: '#b8aed1', b: '#ada2c8' },
};

export function floorTile(name) {
  const key = `floor:${name}`;
  if (cache.has(key)) return cache.get(key);
  const f = FLOORS[name] || FLOORS.checker;
  const cv = document.createElement('canvas');
  cv.width = TILE * 2; cv.height = TILE * 2;
  const g = cv.getContext('2d');
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    g.fillStyle = (i + j) % 2 ? f.b : f.a;
    g.fillRect(i * TILE, j * TILE, TILE, TILE);
    if (f.grout) { g.fillStyle = f.grout; g.fillRect(i * TILE, j * TILE, TILE, 1); g.fillRect(i * TILE, j * TILE, 1, TILE); }
    if (f.dots) { g.fillStyle = f.dots; g.fillRect(i * TILE + 7, j * TILE + 7, 2, 2); }
  }
  if (f.planks) {
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < TILE * 2; y += 8) g.fillRect(0, y, TILE * 2, 1);
    g.fillRect(10, 0, 1, 8); g.fillRect(26, 8, 1, 8); g.fillRect(4, 16, 1, 8); g.fillRect(20, 24, 1, 8);
  }
  cache.set(key, cv);
  return cv;
}
