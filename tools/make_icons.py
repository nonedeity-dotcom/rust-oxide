#!/usr/bin/env python3
"""Ставит иконку Xust (icon.png в корне репозитория) в Android-проект.
Запускается в GitHub Actions после `npx cap add android`; нужен Pillow.
Меняет только ресурсы android/app/src/main/res: значки лаунчера и фон загрузочного экрана."""
import os, sys, glob
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'android/app/src/main/res')
BG = '#0e0b0a'
DPI = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}

src = Image.open(os.path.join(ROOT, 'icon.png')).convert('RGB')
# у исходной картинки скруглённые чёрные углы — обрезаем их и берём центральный квадрат
m = round(src.width * 0.06)
art = src.crop((m, m, src.width - m, src.height - m))

def rounded(img, size, radius_frac):
    img = img.resize((size, size), Image.LANCZOS).convert('RGBA')
    mask = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=int(size * 4 * radius_frac), fill=255)
    img.putalpha(mask.resize((size, size), Image.LANCZOS))
    return img

def circle(img, size):
    return rounded(img, size, 0.5)

def foreground(img, size):
    # адаптивный значок: 108dp полотно, видимая «безопасная» часть — центральные ~66%
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    inner = round(size * 0.667)
    canvas.paste(img.resize((inner, inner), Image.LANCZOS).convert('RGBA'), ((size - inner) // 2, (size - inner) // 2))
    return canvas

def save(img, *parts):
    path = os.path.join(RES, *parts); os.makedirs(os.path.dirname(path), exist_ok=True); img.save(path)

for name, k in DPI.items():
    d = f'mipmap-{name}'
    save(rounded(art, round(48 * k), 0.18), d, 'ic_launcher.png')
    save(circle(art, round(48 * k)), d, 'ic_launcher_round.png')
    save(foreground(art, round(108 * k)), d, 'xust_foreground.png')

# цвет фона и описания адаптивного значка (свои имена ресурсов — конфликтов с шаблоном нет)
os.makedirs(os.path.join(RES, 'values'), exist_ok=True)
with open(os.path.join(RES, 'values', 'xust_colors.xml'), 'w') as fh:
    fh.write(f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="xust_icon_bg">{BG}</color>\n</resources>\n')
adaptive = ('<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <background android:drawable="@color/xust_icon_bg"/>\n    <foreground android:drawable="@mipmap/xust_foreground"/>\n</adaptive-icon>\n')
os.makedirs(os.path.join(RES, 'mipmap-anydpi-v26'), exist_ok=True)
for f in ('ic_launcher.xml', 'ic_launcher_round.xml'):
    open(os.path.join(RES, 'mipmap-anydpi-v26', f), 'w').write(adaptive)

# загрузочный экран: вместо логотипа Capacitor — сплошной тёмный фон (картинка 1×1 растягивается без искажений)
solid = Image.new('RGB', (1, 1), BG)
for f in glob.glob(os.path.join(RES, 'drawable*', 'splash.png')):
    solid.save(f)
print('Xust: значки и заставка обновлены в', RES)
