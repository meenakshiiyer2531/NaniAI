// AUTO-GENERATED from the live Qloo hackathon Taste AI API (one-time snapshot).
// Real Qloo data, cached so the deployed app is instant and reliable during
// judging. Regenerate with: python3 scripts/gen-qloo-snapshot.py <KEY> lib/qloo/snapshot.ts
//   dishTags[dishId] = the dish's real Qloo specialty-dish tag + global popularity
//   cuisineRegion["Cuisine|Region"] = that cuisine's top regional affinity (0..1)

export interface QlooSnapshot {
  dishTags: Record<string, { tag: string; name: string; popularity: number }>;
  cuisineRegion: Record<string, number>;
}

export const QLOO_SNAPSHOT: QlooSnapshot = {
  "dishTags": {
    "idli": {
      "tag": "urn:tag:specialty_dish:place:idli",
      "name": "Idli",
      "popularity": 0.9944
    },
    "masala_dosa": {
      "tag": "urn:tag:specialty_dish:place:masala_dosa",
      "name": "Masala Dosa",
      "popularity": 0.9968
    },
    "uttapam": {
      "tag": "urn:tag:specialty_dish:place:uttapam",
      "name": "Uttapam",
      "popularity": 0.9907
    },
    "ven_pongal": {
      "tag": "urn:tag:specialty_dish:place:pongal",
      "name": "Pongal",
      "popularity": 0.9931
    },
    "millet_idli": {
      "tag": "urn:tag:specialty_dish:place:idli",
      "name": "Idli",
      "popularity": 0.9944
    },
    "ragi_dosa": {
      "tag": "urn:tag:specialty_dish:place:ragi_dosa",
      "name": "Ragi Dosa",
      "popularity": 0.9422
    },
    "curd_rice": {
      "tag": "urn:tag:specialty_dish:place:curd_rice",
      "name": "Curd Rice",
      "popularity": 0.9945
    },
    "sambar": {
      "tag": "urn:tag:specialty_dish:place:sambar",
      "name": "Sambar",
      "popularity": 0.9947
    },
    "rasam": {
      "tag": "urn:tag:specialty_dish:place:rasam",
      "name": "Rasam",
      "popularity": 0.9866
    },
    "avial": {
      "tag": "urn:tag:specialty_dish:place:adai_avial",
      "name": "Adai Avial",
      "popularity": 0.8795
    },
    "payasam": {
      "tag": "urn:tag:specialty_dish:place:payasam",
      "name": "Payasam",
      "popularity": 0.9791
    },
    "ragi_payasam_jaggeryfree": {
      "tag": "urn:tag:specialty_dish:place:payasam",
      "name": "Payasam",
      "popularity": 0.9791
    },
    "medu_vada": {
      "tag": "urn:tag:specialty_dish:place:medu_vada",
      "name": "Medu Vada",
      "popularity": 0.9918
    },
    "lemon_rice": {
      "tag": "urn:tag:specialty_dish:place:lemon_rice_soup",
      "name": "Lemon Rice Soup",
      "popularity": 0.9736
    },
    "moong_dal_khichdi": {
      "tag": "urn:tag:specialty_dish:place:khichdi",
      "name": "Khichdi",
      "popularity": 0.9743
    },
    "palak_paneer": {
      "tag": "urn:tag:specialty_dish:place:palak_paneer",
      "name": "Palak Paneer",
      "popularity": 0.9942
    },
    "oatmeal": {
      "tag": "urn:tag:specialty_dish:place:oatmeal",
      "name": "Oatmeal",
      "popularity": 0.8147
    },
    "kale_salad": {
      "tag": "urn:tag:specialty_dish:place:kale_salad",
      "name": "Kale Salad",
      "popularity": 0.9939
    },
    "grilled_salmon": {
      "tag": "urn:tag:specialty_dish:place:grilled_salmon",
      "name": "Grilled Salmon",
      "popularity": 0.9953
    },
    "greek_yogurt": {
      "tag": "urn:tag:specialty_dish:place:greek_yogurt_parfait",
      "name": "Greek Yogurt Parfait",
      "popularity": 0.9695
    },
    "veg_soup": {
      "tag": "urn:tag:specialty_dish:place:vegetable_soup",
      "name": "Vegetable Soup",
      "popularity": 0.9914
    }
  },
  "cuisineRegion": {
    "South Indian|Tamil Nadu": 0.9468,
    "South Indian|Kerala": 0.9468,
    "South Indian|Karnataka": 0.9468,
    "South Indian|": 0.9468,
    "North Indian|Punjab": 0.9539,
    "North Indian|": 0.9539,
    "Western|": 0.9397
  }
};
