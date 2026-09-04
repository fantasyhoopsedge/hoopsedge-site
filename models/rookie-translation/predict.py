"""Project Year-1 9-cat production for the 2026 rookie class.

Emits the 11 counting quantities the V-score engine consumes (never FG%/FT% —
the engine derives those itself from makes/attempts, and feeding it a percentage
gives wrong results by construction).

Bands come from a Monte Carlo in which MINUTES ARE A SHARED DRAW across all 11
categories. That is the point of the two-stage split: a rookie who gets 30 mpg
instead of 15 doubles every counting stat at once, so the per-category bands are
strongly positively correlated. Sampling each category independently would
generate incoherent players — a 90th-percentile scorer with 10th-percentile
rebounds off the same body — that look fine in a table and are nonsense together.

Zero fabrication: prospects without a full college feature row are emitted with
null projections and an explicit flag. Nothing is imputed from height/position/
school comps.

Reads Supabase read-only (draft picks + the live v1.3 board). Writes exactly one
file: output/rookie-translations-2026.json.

Run: python models/rookie-translation/predict.py
"""

from __future__ import annotations

import json
import os
import urllib.request

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from common import (
    DRAFT_MODEL_CSV, DRAFT_PICK_CORRECTIONS, LATE_PICK_CUTOFF, LATE_RATE_CORRECTION,
    MID_PICK_CUTOFF, MID_RATE_CORRECTION, OUTPUT_JSON, REPO, TOP5_PICK_CUTOFF,
    TOP5_RATE_CORRECTION, TRAIN_TABLE, normalize_name, validate_draft_slots,
)
from features import FEATURES, feature_matrix
from train import ALPHA, TARGETS

N_SIMS = 4000
RNG = np.random.default_rng(20260716)


def _env() -> dict:
    # Real environment variables win (e.g. GitHub Actions secrets, which are
    # never written to a physical .env.local file); the file only fills in
    # keys that aren't already set, and its absence is not an error — mirrors
    # scripts/nba-data/client.ts's loadEnv(). Without this fallback the
    # script hard-crashed in CI, where .env.local is gitignored and never
    # checked out (found 2026-09-04 wiring up the weekly-refresh workflow).
    env = dict(os.environ)
    env_path = os.path.join(REPO, ".env.local")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    if k not in env:
                        env[k] = v.strip().strip('"').strip("'")
    return env


def _sb(path: str):
    env = _env()
    # .strip() guards against a trailing newline in the raw env var (CI secrets
    # in particular) -- Python's http.client rejects any header value containing
    # \r/\n as CRLF-injection protection, unlike Node's Supabase client
    # elsewhere in this same pipeline, which tolerates it silently. Real
    # failure 2026-09-04: ValueError: Invalid header value b'***' on the first
    # real Phase B CI run, only here since this is the one script that builds
    # raw HTTP headers by hand instead of going through a client library.
    url = env["NEXT_PUBLIC_SUPABASE_URL"].strip()
    key = env["SUPABASE_SERVICE_ROLE_KEY"].strip()
    req = urllib.request.Request(f"{url}/rest/v1/{path}",
                                 headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def _fit(X, y):
    m = make_pipeline(StandardScaler(), Ridge(alpha=ALPHA))
    m.fit(X, y)
    return m


def loco_resid_sd(d: pd.DataFrame, cols: list[str]) -> tuple[float, dict[str, float]]:
    """Residual spread from leave-one-class-out — the honest uncertainty, not in-sample."""
    X = d[cols].to_numpy(float)
    mpg_res, r36_res = [], {t: [] for t in TARGETS}
    for cls in sorted(d["draft_class"].unique()):
        te = (d["draft_class"] == cls).to_numpy()
        tr = ~te
        mh = _fit(X[tr], d.loc[tr, "mpg"].to_numpy()).predict(X[te]).clip(1, 40)
        mpg_res.append(d.loc[te, "mpg"].to_numpy() - mh)
        for t in TARGETS:
            y36 = (d.loc[tr, "y_" + t] * 36.0 / d.loc[tr, "mpg"]).to_numpy()
            p36 = _fit(X[tr], y36).predict(X[te])
            true36 = (d.loc[te, "y_" + t] * 36.0 / d.loc[te, "mpg"]).to_numpy()
            r36_res[t].append(true36 - p36)
    return (float(np.std(np.concatenate(mpg_res))),
            {t: float(np.std(np.concatenate(v))) for t, v in r36_res.items()})


def main() -> None:
    dm = pd.read_csv(DRAFT_MODEL_CSV)

    # --- real 2026 NBA draft slots (the board's `pick` is the FANTASY rookie-draft
    # pick "1.01", NOT the NBA slot — using it as the feature would be a scale error).
    roster = _sb("nba_roster?select=full_name,team,draft_year,draft_pick,is_undrafted"
                 "&draft_year=eq.2026&limit=400")
    slot = {normalize_name(r["full_name"]): r for r in roster}

    # Apply known upstream corrections, then validate. A duplicated slot renders as a
    # perfectly ordinary projection while corrupting log(pick), so it must fail loudly.
    for k, correct in DRAFT_PICK_CORRECTIONS.items():
        if k in slot:
            was = slot[k].get("draft_pick")
            if was == correct:
                print(f"  NOTE: correction for '{k}' is REDUNDANT (upstream now says "
                      f"{correct}) — remove it from DRAFT_PICK_CORRECTIONS.")
            else:
                print(f"  applying correction: '{k}' draft_pick {was} -> {correct} "
                      f"(upstream data/nba-rosters/2026-27.csv is wrong)")
                slot[k]["draft_pick"] = correct

    drafted = {k: v["draft_pick"] for k, v in slot.items() if v.get("draft_pick") is not None}
    problems = validate_draft_slots(drafted)
    if problems:
        for p in problems:
            print(f"  !! DRAFT SLOT PROBLEM: {p}")
        raise SystemExit("refusing to project on an invalid draft board — fix the slots first")
    print(f"  draft slots validated: clean 1..{len(drafted)} permutation")
    is2026 = dm["pick"].isna()
    picks = [(slot.get(normalize_name(n)) or {}).get("draft_pick") for n in dm.loc[is2026, "name"]]
    # Undrafted / not-found stay NaN and are flagged NOT_PROJECTED rather than imputed.
    dm.loc[is2026, "pick"] = pd.Series(
        [np.nan if v is None else float(v) for v in picks], index=dm.index[is2026], dtype="float64"
    )

    fm = feature_matrix(dm)  # priors over all 771 rows — identical to training
    fm["k"] = fm["name"].map(normalize_name)
    fut = fm[fm["season"] == 2026].copy()

    # Raw (pre-z-score) college games, for the thin-sample flag. `gp` inside the
    # feature matrix is z-scored within class, so thresholding it against a game
    # count is meaningless — it reported "gp=-4" for a 4-game season.
    raw_gp = {normalize_name(n): int(g) for n, g in zip(dm["name"], dm["gp"])}

    # --- training set
    tr = pd.read_csv(TRAIN_TABLE)
    feat = fm[fm["pick"].notna() & (fm["season"] < 2026)][["name"] + FEATURES]
    feat = feat.rename(columns={c: "f_" + c for c in FEATURES})
    cols = ["f_" + c for c in FEATURES]
    d = tr.merge(feat, on="name", how="inner", validate="one_to_one")
    print(f"training rows: {len(d)}   2026 rows: {len(fut)}")

    sd_mpg, sd36 = loco_resid_sd(d, cols)
    print(f"LOCO residual sd — mpg: {sd_mpg:.2f}")

    X = d[cols].to_numpy(float)
    mpg_model = _fit(X, d["mpg"].to_numpy())
    r36_models = {t: _fit(X, (d["y_" + t] * 36.0 / d["mpg"]).to_numpy()) for t in TARGETS}

    # --- out-of-distribution envelope from the training classes
    lo = {c: float(d["f_" + c].quantile(0.01)) for c in FEATURES}
    hi = {c: float(d["f_" + c].quantile(0.99)) for c in FEATURES}

    board = [x for x in _sb("rb_docs?select=slug,data") if x["slug"] == "live"][0]["data"]
    players = board["players"]
    print(f"board v{board.get('version')}: {len(players)} players")

    fut_by_k = {r["k"]: r for _, r in fut.iterrows()}
    out = []
    projected = 0
    corrected_counts = {"TOP5_RATE_CORRECTED": 0, "MID_RATE_CORRECTED": 0, "LATE_RATE_CORRECTED": 0}

    for p in players:
        k = normalize_name(p["name"])
        rec = {
            "name": p["name"], "rank": p.get("rank"), "tier": p.get("tier"),
            "pos": p.get("pos"), "school": p.get("school"), "nbaTeam": p.get("nbaTeam"),
            "isRookie": True, "confidenceTier": "Low",
            "nbaDraftPick": (slot.get(k) or {}).get("draft_pick"),
            "projections": None, "flags": [],
        }
        row = fut_by_k.get(k)
        if row is None:
            rec["flags"].append("NO_COLLEGE_FEATURE_ROW")
            rec["flags"].append("NOT_PROJECTED")
            out.append(rec)
            continue
        if pd.isna(row["pick"]):
            rec["flags"].append("NO_NBA_DRAFT_SLOT")
            rec["flags"].append("NOT_PROJECTED")
            out.append(rec)
            continue

        x = row[FEATURES].to_numpy(float).reshape(1, -1)
        if np.isnan(x).any():
            rec["flags"].append("INCOMPLETE_FEATURES")
            rec["flags"].append("NOT_PROJECTED")
            out.append(rec)
            continue

        # OOD: report rather than quietly extrapolate.
        oob = [c for c in FEATURES if not (lo[c] <= float(row[c]) <= hi[c])]
        if oob:
            rec["flags"].append("OUT_OF_DISTRIBUTION:" + ",".join(sorted(oob)[:6]))
        g = raw_gp.get(k)
        if g is not None and g < 10:
            rec["flags"].append(f"THIN_COLLEGE_SAMPLE:gp={g}")

        mpg_hat = float(mpg_model.predict(x)[0])
        mpg_draw = np.clip(RNG.normal(mpg_hat, sd_mpg, N_SIMS), 0.0, 40.0)

        # Pick-range rate correction: Stage B (the per-36 skill model) has a
        # confirmed, forward-chain-validated underprediction bias, independently
        # measured and independently shaped in each of three pick-range buckets
        # (scoring/shot-volume/playmaking rates only -- reb/stl/blk are close to
        # unbiased everywhere). See common.py's TOP5_RATE_CORRECTION,
        # MID_RATE_CORRECTION, and LATE_RATE_CORRECTION for full provenance --
        # each bucket's correction is its own measurement, not a scaled copy of
        # a neighboring one, and must not be extended past its own cutoff.
        pick = row["pick"] if pd.notna(row["pick"]) else None
        if pick is not None and pick <= TOP5_PICK_CUTOFF:
            correction, flag = TOP5_RATE_CORRECTION, "TOP5_RATE_CORRECTED"
        elif pick is not None and pick <= MID_PICK_CUTOFF:
            correction, flag = MID_RATE_CORRECTION, "MID_RATE_CORRECTED"
        elif pick is not None and pick <= LATE_PICK_CUTOFF:
            correction, flag = LATE_RATE_CORRECTION, "LATE_RATE_CORRECTED"
        else:
            correction, flag = {}, None
        if flag:
            rec["flags"].append(flag)
            corrected_counts[flag] += 1

        proj = {"mpg": {"p10": float(np.quantile(mpg_draw, .10)),
                        "p50": float(np.quantile(mpg_draw, .50)),
                        "p90": float(np.quantile(mpg_draw, .90))}}
        for t in TARGETS:
            r36 = float(r36_models[t].predict(x)[0]) + correction.get(t, 0.0)
            draws = np.clip(r36 + RNG.normal(0, sd36[t], N_SIMS), 0, None) * mpg_draw / 36.0
            proj[t] = {"p10": round(float(np.quantile(draws, .10)), 2),
                       "p50": round(float(np.quantile(draws, .50)), 2),
                       "p90": round(float(np.quantile(draws, .90)), 2)}
        proj["mpg"] = {q: round(v, 1) for q, v in proj["mpg"].items()}
        rec["projections"] = proj
        projected += 1
        out.append(rec)

    doc = {
        "schemaVersion": 1,
        "generatedAt": pd.Timestamp.now("UTC").isoformat(),
        "model": "rookie-translation/year1-9cat",
        "boardVersion": board.get("version"),
        "trainingRows": int(len(d)),
        "trainingClasses": [int(c) for c in sorted(d["draft_class"].unique())],
        "targetBasis": "per-game, rookie season = first season with NBA minutes",
        "note": ("Counting stats only. FG%/FT% are intentionally absent: the V-score "
                 "engine derives them from makes/attempts and must not be fed a percentage. "
                 "Every pick 1-30 carries a forward-chain-validated per-36 bias correction, "
                 "independently measured per pick-range bucket (TOP5_RATE_CORRECTED / "
                 "MID_RATE_CORRECTED / LATE_RATE_CORRECTED flags) -- see common.py's "
                 "TOP5_RATE_CORRECTION / MID_RATE_CORRECTION / LATE_RATE_CORRECTION."),
        "players": out,
    }
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
    print(f"\nprojected {projected} / {len(players)} board players "
          f"({corrected_counts['TOP5_RATE_CORRECTED']} top5, "
          f"{corrected_counts['MID_RATE_CORRECTED']} mid, "
          f"{corrected_counts['LATE_RATE_CORRECTED']} late rate-corrected)")
    print(f"wrote {OUTPUT_JSON}")


if __name__ == "__main__":
    main()
