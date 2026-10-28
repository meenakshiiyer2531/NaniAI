#!/usr/bin/env python3
# One-time generator: pulls REAL Qloo Taste AI data and emits a committed
# snapshot (lib/qloo/snapshot.ts). Honest cached taste data so the deployed
# app is instant and reliable during judging. Regenerate when dishes change.
import json, sys, time, urllib.parse, urllib.request

KEY = sys.argv[1]
OUT = sys.argv[2]
BASE = "https://hackathon.api.qloo.com"

def get(path, params, tries=2):
    url = BASE + path + "?" + urllib.parse.urlencode(params)
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"X-Api-Key": KEY, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(1)

# dishId -> search query (the core dish name Qloo knows)
DISH_QUERIES = {
    "idli": "idli", "masala_dosa": "masala dosa", "uttapam": "uttapam",
    "ven_pongal": "pongal", "millet_idli": "idli", "ragi_dosa": "ragi dosa",
    "curd_rice": "curd rice", "sambar": "sambar", "rasam": "rasam",
    "avial": "avial", "payasam": "payasam", "ragi_payasam_jaggeryfree": "payasam",
    "medu_vada": "medu vada", "lemon_rice": "lemon rice",
    "moong_dal_khichdi": "khichdi", "palak_paneer": "palak paneer",
    "oatmeal": "oatmeal", "kale_salad": "kale salad",
    "grilled_salmon": "grilled salmon", "greek_yogurt": "greek yogurt",
    "veg_soup": "vegetable soup",
}

CUISINE_TAG = {
    "South Indian": "urn:tag:cuisine:qloo:south_indian",
    "North Indian": "urn:tag:cuisine:qloo:north_indian",
    "Western": "urn:tag:cuisine:qloo:western",
}

CUISINE_REGION_PAIRS = [
    ("South Indian", "Tamil Nadu"), ("South Indian", "Kerala"),
    ("South Indian", "Karnataka"), ("South Indian", ""),
    ("North Indian", "Punjab"), ("North Indian", ""), ("Western", ""),
]

# 1) per-dish specialty tag + real popularity
dish_tags = {}
for dish_id, q in DISH_QUERIES.items():
    try:
        d = get("/v2/tags", {"filter.query": q})
        tags = d.get("results", {}).get("tags", [])
        pick = next((t for t in tags if "specialty_dish" in (t.get("id") or "")), None)
        if not pick and tags:
            pick = tags[0]
        if pick:
            dish_tags[dish_id] = {
                "tag": pick.get("id"),
                "name": pick.get("name"),
                "popularity": round(float(pick.get("popularity", 0)), 4),
            }
            print(f"OK dish {dish_id}: {pick.get('name')} ({dish_tags[dish_id]['popularity']})", file=sys.stderr)
        else:
            print(f"-- no tag for {dish_id}", file=sys.stderr)
    except Exception as e:
        print(f"ERR dish {dish_id}: {e}", file=sys.stderr)

# 2) regional cuisine strength: top specialty-dish affinity for cuisine+region
cuisine_region = {}
for cuisine, region in CUISINE_REGION_PAIRS:
    params = {
        "filter.type": "urn:tag",
        "filter.tag.types": "urn:tag:specialty_dish:place",
        "signal.interests.tags": CUISINE_TAG[cuisine],
        "take": "20",
    }
    if region:
        params["filter.location.query"] = region
    try:
        d = get("/v2/insights", params)
        tags = d.get("results", {}).get("tags", [])
        affs = [(t.get("query", {}) or {}).get("affinity") for t in tags]
        affs = [float(a) for a in affs if a is not None]
        top = round(max(affs), 4) if affs else 0.0
        cuisine_region[f"{cuisine}|{region}"] = top
        print(f"OK region {cuisine}|{region}: {top}", file=sys.stderr)
    except Exception as e:
        print(f"ERR region {cuisine}|{region}: {e}", file=sys.stderr)

snapshot = {"dishTags": dish_tags, "cuisineRegion": cuisine_region}

ts = (
    "// AUTO-GENERATED from the live Qloo hackathon Taste AI API (one-time snapshot).\n"
    "// Real Qloo data, cached so the deployed app is instant and reliable during\n"
    "// judging. Regenerate with: python3 scripts/gen-qloo-snapshot.py <KEY> lib/qloo/snapshot.ts\n"
    "//   dishTags[dishId] = the dish's real Qloo specialty-dish tag + global popularity\n"
    "//   cuisineRegion[\"Cuisine|Region\"] = that cuisine's top regional affinity (0..1)\n\n"
    "export interface QlooSnapshot {\n"
    "  dishTags: Record<string, { tag: string; name: string; popularity: number }>;\n"
    "  cuisineRegion: Record<string, number>;\n"
    "}\n\n"
    "export const QLOO_SNAPSHOT: QlooSnapshot = " + json.dumps(snapshot, indent=2) + ";\n"
)
with open(OUT, "w") as f:
    f.write(ts)
print(f"WROTE {OUT}", file=sys.stderr)
