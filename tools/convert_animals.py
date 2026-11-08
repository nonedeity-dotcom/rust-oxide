# OBJ (Z-up, морда к +X) -> js/animals.js (Y-up). Запуск: python3 tools/convert_animals.py
# Каждая модель делится на тело и 4 ноги (с отдельной точкой-«бедром»), чтобы ноги можно было качать при ходьбе.
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
mtl, cur = {}, None
for l in (root/'models/animals.mtl').read_text().splitlines():
    p = l.split()
    if p and p[0] == 'newmtl': cur = p[1]
    elif p and p[0] == 'Kd': mtl[cur] = tuple(float(x) for x in p[1:4])
hexc = lambda c: sum(round(v*255) << s for v, s in zip(c, (16, 8, 0)))

def load(name):
    V, F, M, m = [], [], [], None
    for l in (root/f'models/{name}_lowpoly.obj').read_text().splitlines():
        p = l.split()
        if not p: continue
        if p[0] == 'v': V.append(tuple(map(float, p[1:4])))
        elif p[0] == 'usemtl': m = p[1]
        elif p[0] == 'f':
            F.append([int(t.split('/')[0]) - 2 for t in p[1:]]); M.append(m)  # в этих OBJ индексы граней смещены на +1 (и ещё +1 от нумерации с 1)
    return V, F, M

def components(V, F):
    par = list(range(len(V)))
    def find(a):
        while par[a] != a: par[a] = par[par[a]]; a = par[a]
        return a
    for f in F:
        for i in f[1:]: par[find(i)] = find(f[0])
    comp = {}
    for fi, f in enumerate(F): comp.setdefault(find(f[0]), []).append(fi)
    return list(comp.values())

def build(V, F, M, faces, pal, pivot):
    """Часть модели: faces -> компактные вершины (Y-up, относительно pivot), треугольники и индекс цвета."""
    vm, v, tri, col = {}, [], [], []
    def vid(i):
        if i not in vm:
            x, y, z = V[i]; vm[i] = len(v) // 3  # Z-up -> Y-up: (x, y, z) -> (x, z, -y)
            v.extend([round(x - pivot[0], 3), round(z - pivot[2], 3), round(-(y - pivot[1]), 3)])
        return vm[i]
    for fi in faces:
        idx = [vid(i) for i in F[fi]]
        for k in range(1, len(idx) - 1): tri.append((idx[0], idx[k], idx[k+1])); col.append(pal.index(M[fi]))
    # ориентация граней: объём замкнутой оболочки должен быть положительным, иначе переворачиваем
    vol = 0
    for a, b, c in tri:
        A, B, C = (v[a*3:a*3+3], v[b*3:b*3+3], v[c*3:c*3+3])
        vol += sum(p*q for p, q in zip(A, (B[1]*C[2]-B[2]*C[1], B[2]*C[0]-B[0]*C[2], B[0]*C[1]-B[1]*C[0])))
    if vol < 0: tri = [(a, c, b) for a, b, c in tri]
    return {'v': v, 'f': [i for t in tri for i in t], 'c': col}, vol

def convert(name):
    V, F, M = load(name)
    pal = sorted(set(M))
    comps = components(V, F)
    legs, body = {}, []
    for fs in comps:
        vs = {i for f in fs for i in F[f]}
        xs, ys, zs = [V[i][0] for i in vs], [V[i][1] for i in vs], [V[i][2] for i in vs]
        # часть ноги: тонкая, достаёт почти до земли и не выше «бедра»
        if max(ys) - min(ys) < 0.45 and min(zs) < 0.3 and max(zs) < 0.95:
            front = (min(xs) + max(xs)) / 2 > 0.1; left = (min(ys) + max(ys)) / 2 > 0
            legs.setdefault((front, left), []).append((fs, min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)))
        else: body.append(fs)
    assert len(legs) == 4, (name, 'ног', len(legs))
    out = {'pal': [hexc(mtl[m]) for m in pal]}
    bpart, bvol = build(V, F, M, [f for fs in body for f in fs], pal, (0, 0, 0))
    out['body'] = bpart
    out['legs'] = []
    vols = [round(bvol, 2)]
    for key in [(True, False), (True, True), (False, False), (False, True)]:  # ПЛ, ПП, ЗЛ, ЗП: пары по диагонали ходят вместе
        parts = legs[key]
        upper = max(parts, key=lambda p: p[6])               # самая высокая часть — сама нога
        pivot = ((upper[1] + upper[2]) / 2, (upper[3] + upper[4]) / 2, upper[6])  # бедро: верх ноги
        lp, lvol = build(V, F, M, [f for p in parts for f in p[0]], pal, pivot)
        lp['pivot'] = [round(pivot[0], 3), round(pivot[2], 3), round(-pivot[1], 3)]
        out['legs'].append(lp); vols.append(round(lvol, 2))
    print(name, 'тело', len(bpart['f'])//3, 'тр.', 'ноги', [len(l['f'])//3 for l in out['legs']], 'объёмы до коррекции', vols)
    return out

if __name__ == '__main__':
    out = {n: convert(n) for n in ('bear', 'deer', 'boar')}
    (root/'js/animals.js').write_text('// Сгенерировано tools/convert_animals.py из models/{bear,deer,boar}_lowpoly.obj\n// pal — цвета, body/legs — { v: вершины, f: треугольники, c: цвет каждого }, legs[i].pivot — «бедро»\nexport const ANIMAL_MODELS = ' + json.dumps(out, separators=(',', ':')) + ';\n')
