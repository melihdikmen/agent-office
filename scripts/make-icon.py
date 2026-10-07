# Generates build/icon.png (1024px) from a 16x16 pixel-art logo; no dependencies.
import zlib, struct
P = {'.': None, 'k': (27,23,21), 'a': (242,139,106), 'd': (176,92,64), 'w': (234,226,216), 'g': (122,215,160), 'b': (43,38,34), 'y': (242,201,76)}
ART = [
"................",
"..kkkkkkkkkkkk..",
".kkkkkkkkkkkkkk.",
".kkaaaaaaaaaakk.",
".kkawwwwwwwwakk.",
".kkawgwwwwwwakk.",
".kkawwgwwwwwakk.",
".kkawgwwywwwakk.",
".kkawwwwwwwwakk.",
".kkaaaaaaaaaakk.",
".kkkkkddddkkkkk.",
".kkkkkkddkkkkkk.",
".kkkbbbbbbbbkkk.",
".kkkbkkkkkkbkkk.",
".kkkkkkkkkkkkkk.",
"................",
]
N, S = 16, 64
W = N * S
bg = (27,23,21)
def px(x, y):
    c = P[ART[y // S][x // S]]
    return c
rows = bytearray()
for y in range(W):
    rows.append(0)
    for x in range(W):
        c = px(x, y)
        # rounded corners via alpha
        r = 180; cx = min(x, W-1-x); cy = min(y, W-1-y)
        a = 255
        if cx < r and cy < r and (r-cx)**2 + (r-cy)**2 > r*r: a = 0
        if c is None: c = bg; a = 0
        rows += bytes((*c, a))
def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', W, W, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(rows), 9)) + chunk(b'IEND', b'')
open('build/icon.png', 'wb').write(png)
