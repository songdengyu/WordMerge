"""Read selected Unity textures; never execute or modify the source game.

Usage: python scripts/extract_scene_samples.py C:/Users/cf/Desktop/Gossip
Requires UnityPy and Pillow (authoring tools only).
"""
import argparse
import hashlib
import json
from pathlib import Path

import UnityPy

SAMPLES = [
    ('map-main*.bundle', 'outtree_B', 'tree', None),
    ('map-localslots_assets_assets/map/area1_*.bundle', 'patiochaira_1', 'chair', None),
    ('map-localslots_assets_assets/map/area2_*.bundle', 'canteenplants_1', 'planter', None),
    ('map-main*.bundle', 'housewood_01', 'wall', (96, 0, 192, 256)),
    ('map-localslots_assets_assets/map/area1_*.bundle', 'Wood2_1', 'floor', (0, 0, 256, 128)),
    ('map-main*.bundle', 'houseroof_01', 'roof', (0, 0, 256, 256)),
    ('map-main*.bundle', 'outflower_D', 'shrub', None),
    ('map-main*.bundle', 'outcoconuttree_c01', 'fruit-tree', None),
    ('map-main*.bundle', 'outstone_B', 'boulder', None),
    ('map-main*.bundle', 'outrock_b01', 'campfire', None),
    ('map-main*.bundle', 'outchair_C', 'bed', None),
    ('map-main*.bundle', 'outlight_A', 'lantern', None),
    ('map-localslots_assets_assets/map/area1_*.bundle', 'patiobrand_1', 'sign', None),
    ('map-localslots_assets_assets/map/area1_*.bundle', 'patiorobject_3', 'statue', None),
    ('map-localslots_assets_assets/map/area1_*.bundle', 'patiotable_1', 'table', None),
    ('map-localslots_assets_assets/map/area1_*.bundle', 'shrubsC_1', 'flowerstand', None),
    ('map-localslots_assets_assets/map/area2_*.bundle', 'canteencarpet_1', 'rug', None),
    ('map-localslots_assets_assets/map/area2_*.bundle', 'canteenchairc_2', 'sofa', None),
    ('map-localslots_assets_assets/map/area3_*.bundle', 'kitchenrack_1', 'bookshelf', None),
    ('map-localslots_assets_assets/map/area3_*.bundle', 'kitchenutensilsb_2', 'tea-set', None),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'public/assets/survival/scene')
    args = parser.parse_args()
    root = args.source.resolve() / 'assets/aa/android'
    output = args.output.resolve()
    if output.is_relative_to(args.source.resolve()):
        raise ValueError('Output must be outside the read-only source package')
    extracted, records = [], []
    for pattern, name, key, crop in SAMPLES:
        bundles = list(root.glob(pattern))
        if len(bundles) != 1:
            raise ValueError(f'Expected one bundle for {pattern}, got {len(bundles)}')
        bundle = bundles[0]
        env = UnityPy.load(str(bundle))
        matches = [o.read() for o in env.objects if o.type.name == 'Texture2D' and o.peek_name() == name]
        if len(matches) != 1:
            raise ValueError(f'Expected one Texture2D named {name}')
        image = matches[0].image.convert('RGBA')
        original_size = list(image.size)
        if crop:
            image = image.crop(crop)
        extracted.append((key, image))
        records.append(dict(file=f'{key}.png', bundle=bundle.relative_to(root).as_posix(),
                            bundleSha256=hashlib.sha256(bundle.read_bytes()).hexdigest(),
                            texture=name, originalSize=original_size, crop=crop,
                            outputSize=list(image.size), processing='UnityPy RGBA decode; optional material swatch crop; no resizing'))
    output.mkdir(parents=True, exist_ok=True)
    for key, image in extracted:
        image.save(output / f'{key}.png', optimize=True)
    for record in records:
        data = (output / record['file']).read_bytes()
        record.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
    (output / 'sources.json').write_text(json.dumps({'source': 'User-provided Gossip Android package', 'assets': records}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Exported {len(records)} textures, {sum(r["bytes"] for r in records):,} bytes to {output}')


if __name__ == '__main__':
    main()
