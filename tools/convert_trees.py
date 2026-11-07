# OBJ (Z-up) -> js/trees.js (Y-up, цвета по граням). Запуск: python3 tools/convert_trees.py
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
mtl, cur = {}, None
for l in (root/'models/trees.mtl').read_text().splitlines():
    p = l.split()
    if p and p[0] == 'newmtl': cur = p[1]
    elif p and p[0] == 'Kd': mtl[cur] = tuple(float(x) for x in p[1:4])
mtl['pine_dark'] = (0.07, 0.2, 0.1)
hexc = lambda c: sum(round(v*255) << s for v, s in zip(c, (16, 8, 0)))
snow = lambda c: tuple(v*0.35 + 0.65*w for v, w in zip(c, (0.93, 0.96, 1.0)))
names = {'oak': 'oak', 'apple': 'apple_tree', 'birch': 'birch', 'autumn': 'autumn_tree', 'palm': 'palm', 'pine': 'pine'}
out = {}
for key, fn in names.items():
    V, tris, cols, m = [], [], [], None
    for l in (root/f'models/{fn}_lowpoly.obj').read_text().splitlines():
        p = l.split()
        if not p: continue
        if p[0] == 'v': x, y, z = map(float, p[1:4]); V.append((x, z, -y))  # Z-up -> Y-up
        elif p[0] == 'usemtl': m = p[1]
        elif p[0] == 'f':
            idx = [int(t.split('/')[0]) - 2 for t in p[1:]]  # в этих OBJ индексы граней смещены на +1
            for i in range(1, len(idx) - 1): tris.append((idx[0], idx[i], idx[i+1])); cols.append(m)
    def cross_dot(a, b, c):
        A, B, C = V[a], V[b], V[c]
        cx = (B[1]*C[2]-B[2]*C[1], B[2]*C[0]-B[0]*C[2], B[0]*C[1]-B[1]*C[0])
        return sum(p*q for p, q in zip(A, cx))
    vol = sum(cross_dot(*t) for t in tris)
    if vol < 0: tris = [(a, c, b) for a, b, c in tris]
    pal = sorted(set(cols))
    pos = [round(v, 3) for t in tris for i in t for v in V[i]]
    out[key] = {'pos': pos, 'tri': [pal.index(c) for c in cols], 'pal': [hexc(mtl[c]) for c in pal]}
    if key == 'pine':
        out['snowpine'] = {'pos': pos, 'tri': out[key]['tri'], 'pal': [hexc(snow(mtl[c])) if c.startswith('pine') else hexc(mtl[c]) for c in pal]}
    print(key, len(tris), 'tris', 'vol', round(vol, 2), 'flipped' if vol < 0 else 'ok')
(root/'js/trees.js').write_text('// Сгенерировано tools/convert_trees.py из models/*.obj\nexport const TREES = ' + json.dumps(out, separators=(',', ':')) + ';\n')
