"""Fit and validate the Year-1 rookie translation model.

Structure — two-stage, per the design:
  Stage A: predict rookie MPG (opportunity). Mostly a fact about the team.
  Stage B: predict per-36 rates (skill). This is what college play informs.
  per-game = per36 * mpg / 36

The split matters because Engelmann's methodology addresses skill and explicitly
not playing time ("durability is not considered"). Asking one model to learn both
conflates them. It also makes minutes a SHARED factor: a rookie who gets 30 mpg
instead of 15 doubles every counting stat at once, so category bands are strongly
correlated, not independent. predict.py exploits that; here we just validate.

Validation is leave-one-draft-class-out (16 folds) plus a forward-chaining split,
which is the honest deployment analogue. Random row splits would leak class-level
signal and are never used.

Run: python models/rookie-translation/train.py
"""

from __future__ import annotations


import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from common import (
    DRAFT_MODEL_CSV, LATE_PICK_CUTOFF, LATE_RATE_CORRECTION, MID_PICK_CUTOFF,
    MID_RATE_CORRECTION, TOP5_PICK_CUTOFF, TOP5_RATE_CORRECTION, TRAIN_TABLE,
)
from features import FEATURES, feature_matrix

TARGETS = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m", "fgm", "fga", "ftm", "fta"]
ALPHA = 10.0


def load() -> tuple[pd.DataFrame, list[str]]:
    """Join college features onto rookie-year targets.

    Every college feature is namespaced `f_`. This is not cosmetic: the target
    table and the draft model BOTH carry an `mpg` column (rookie NBA minutes vs
    college minutes). An unprefixed merge silently resolves `mpg` to the NBA
    value and leaks the Stage A target into its own feature set — which is
    exactly what happened on the first run (Stage A scored corr=1.000).
    """
    tr = pd.read_csv(TRAIN_TABLE)
    dm = pd.read_csv(DRAFT_MODEL_CSV)
    # Build features over ALL 771 rows, then filter. The EB priors (population make
    # rate, median possessions) are computed from the rows passed in, so fitting on
    # 722 and serving on 49 would use different priors — train/serve feature drift.
    # Within-class z-scoring is per-class and unaffected either way.
    fm = feature_matrix(dm)
    fm = fm[fm["pick"].notna()].copy()

    feat = fm[["name"] + FEATURES].rename(columns={c: "f_" + c for c in FEATURES})
    cols = ["f_" + c for c in FEATURES]
    tr = tr.merge(feat, on="name", how="inner", validate="one_to_one")

    overlap = set(cols) & set(pd.read_csv(TRAIN_TABLE).columns)
    assert not overlap, f"feature/target name collision: {overlap}"
    return tr, cols


def _fit(X, y):
    m = make_pipeline(StandardScaler(), Ridge(alpha=ALPHA))
    m.fit(X, y)
    return m


def loco_predict(d: pd.DataFrame, cols: list[str], two_stage: bool) -> pd.DataFrame:
    """Leave-one-draft-class-out cross-validated predictions."""
    preds = {t: np.full(len(d), np.nan) for t in TARGETS}
    preds["mpg"] = np.full(len(d), np.nan)
    X_all = d[cols].to_numpy(float)

    for cls in sorted(d["draft_class"].unique()):
        te = (d["draft_class"] == cls).to_numpy()
        tr = ~te
        Xtr, Xte = X_all[tr], X_all[te]

        mpg_hat = _fit(Xtr, d.loc[tr, "mpg"].to_numpy()).predict(Xte).clip(1.0, 40.0)
        preds["mpg"][te] = mpg_hat

        for t in TARGETS:
            if two_stage:
                # Stage B: per-36 rate, learned free of opportunity.
                y36 = d.loc[tr, "y_" + t] * 36.0 / d.loc[tr, "mpg"]
                r36 = _fit(Xtr, y36.to_numpy()).predict(Xte).clip(0, None)
                preds[t][te] = r36 * mpg_hat / 36.0
            else:
                preds[t][te] = _fit(Xtr, d.loc[tr, "y_" + t].to_numpy()).predict(Xte).clip(0, None)
    return pd.DataFrame(preds)


def forward_chain(d: pd.DataFrame, cols: list[str], two_stage: bool = True) -> pd.DataFrame:
    """Expanding-window split: train on classes <= t, test on t+1. Deployment analogue."""
    preds = {t: np.full(len(d), np.nan) for t in TARGETS}
    X_all = d[cols].to_numpy(float)
    classes = sorted(d["draft_class"].unique())
    for i, cls in enumerate(classes):
        if i < 5:
            continue  # need a warm-up history
        tr = (d["draft_class"] < cls).to_numpy()
        te = (d["draft_class"] == cls).to_numpy()
        Xtr, Xte = X_all[tr], X_all[te]
        mpg_hat = _fit(Xtr, d.loc[tr, "mpg"].to_numpy()).predict(Xte).clip(1.0, 40.0)
        for t in TARGETS:
            if two_stage:
                y36 = d.loc[tr, "y_" + t] * 36.0 / d.loc[tr, "mpg"]
                r36 = _fit(Xtr, y36.to_numpy()).predict(Xte).clip(0, None)
                preds[t][te] = r36 * mpg_hat / 36.0
            else:
                preds[t][te] = _fit(Xtr, d.loc[tr, "y_" + t].to_numpy()).predict(Xte).clip(0, None)
    return pd.DataFrame(preds)


def report(d: pd.DataFrame, p: pd.DataFrame, label: str) -> pd.DataFrame:
    rows = []
    for t in TARGETS:
        m = p[t].notna().to_numpy()
        y, yh = d.loc[m, "y_" + t].to_numpy(), p.loc[m, t].to_numpy()
        mae = np.mean(np.abs(y - yh))
        rmse = np.sqrt(np.mean((y - yh) ** 2))
        # baseline = predict the training mean
        base = np.mean(np.abs(y - y.mean()))
        rows.append({"cat": t, "MAE": mae, "RMSE": rmse, "MAE_mean_baseline": base,
                     "skill_vs_mean_%": 100 * (1 - mae / base), "n": int(m.sum())})
    r = pd.DataFrame(rows)
    print(f"\n=== {label} ===")
    print(r.round(3).to_string(index=False))
    return r


MIN_TOP5_YEAR_N = 4   # picks 1-5  (5 slots): need >=4 NCAA-eligible to count a year
MIN_MID_YEAR_N = 5    # picks 6-14 (9 slots): need >=5
MIN_LATE_YEAR_N = 9   # picks 15-30 (16 slots): need >=9
# Below its threshold, a class isn't missing data at random -- it's missing
# exactly the international/G-League/Overtime Elite prospects (Wembanyama,
# Scoot Henderson, both Thompson twins in 2023; Risacher, Sarr, Holland in
# 2024) that this NCAA-only model can never project, so a thin-year "class
# average" is not a fair read of that class. The two lower buckets have more
# slots than the top-5 one, so in practice every year 2015-2025 clears their
# (proportionally similar, ~55-60%) thresholds -- only the top-5 bucket
# actually loses years to this filter, because 2-3 missing players is a much
# bigger fraction of 5 slots than of 9 or 16.

# (bucket name, pick range, min-N threshold, shipped correction) -- the single
# source of truth both bucket_bias_correction() and predict.py's pick-range
# dispatch are built from.
BUCKETS = [
    ("top5", 1, TOP5_PICK_CUTOFF, MIN_TOP5_YEAR_N, TOP5_RATE_CORRECTION),
    ("mid", TOP5_PICK_CUTOFF + 1, MID_PICK_CUTOFF, MIN_MID_YEAR_N, MID_RATE_CORRECTION),
    ("late", MID_PICK_CUTOFF + 1, LATE_PICK_CUTOFF, MIN_LATE_YEAR_N, LATE_RATE_CORRECTION),
]


def bucket_bias_correction(d: pd.DataFrame, cols: list[str], lo: int, hi: int, min_n: int) -> dict[str, float]:
    """Per-36 bias for picks [lo, hi], pooled across every historical draft
    class with an adequate NCAA-eligible sample in that range -- the shared
    engine behind TOP5_RATE_CORRECTION, MID_RATE_CORRECTION, and
    LATE_RATE_CORRECTION (see common.py for each constant's full provenance).

    STRICT FORWARD-CHAIN, not nested-LOCO: for each candidate year Y, the model
    is fit ONLY on classes strictly before Y (train < Y, test == Y), exactly
    the information a real deployment would have had at the time. An earlier
    nested-LOCO version of the top-5 correction (each class's contribution
    excluded only its own residual, but could still be informed by classes
    that happened chronologically LATER than the one being scored) was
    measurably too optimistic -- see TOP5_RATE_CORRECTION's comment for the
    +0.55 vs +1.88 pts before/after switching methodology. Forward-chain is
    the honest number because a correction can only ever be built from classes
    that have ALREADY happened.

    A 5-class warm-up (matching forward_chain()'s convention) is required
    before any year is eligible, so the earliest classes never contribute --
    there isn't enough training history to fit anything meaningful off of.
    """
    classes = sorted(d["draft_class"].unique())
    warm_start = classes[5] if len(classes) > 5 else classes[0]
    X_all = d[cols].to_numpy(float)

    resid36 = {t: [] for t in TARGETS}
    for year in [c for c in classes if c >= warm_start]:
        tr = (d["draft_class"] < year).to_numpy()
        te = ((d["draft_class"] == year) & (d["pick"] >= lo) & (d["pick"] <= hi)).to_numpy()
        if te.sum() < min_n:
            continue
        Xtr, Xte = X_all[tr], X_all[te]
        for t in TARGETS:
            y36 = (d.loc[tr, "y_" + t] * 36.0 / d.loc[tr, "mpg"]).to_numpy()
            p36 = _fit(Xtr, y36).predict(Xte).clip(0, None)
            true36 = (d.loc[te, "y_" + t] * 36.0 / d.loc[te, "mpg"]).to_numpy()
            resid36[t].extend((true36 - p36).tolist())

    return {t: float(np.mean(vals)) for t, vals in resid36.items()}


def top5_bias_correction(d: pd.DataFrame, cols: list[str]) -> dict[str, float]:
    return bucket_bias_correction(d, cols, 1, TOP5_PICK_CUTOFF, MIN_TOP5_YEAR_N)


def check_bucket_corrections(d: pd.DataFrame, cols: list[str]) -> None:
    """Print current vs. shipped rate correction (forward-chain re-measure) for
    ALL THREE pick-range buckets, plus the bias each removes under a broader
    single-split LOCO (a different and intentionally less strict lens -- every
    class informs every other class's prediction here, unlike the forward-chain
    basis above). Two different validations of each constant, not the same
    number twice.

    Run whenever a new draft class's rookie-year data lands, so drift in any
    of the three corrections (as their forward-chain-eligible year counts
    grow) gets caught instead of silently going stale.
    """
    X_all = d[cols].to_numpy(float)
    true36 = {t: (d["y_" + t] * 36.0 / d["mpg"]).to_numpy() for t in TARGETS}

    for name, lo, hi, min_n, shipped in BUCKETS:
        fresh = bucket_bias_correction(d, cols, lo, hi, min_n)
        print(f"\n=== {name} (picks {lo}-{hi}) rate correction: shipped vs. freshly re-measured (forward-chain) ===")
        for t in TARGETS:
            print(f"  {t:5s}  shipped={shipped.get(t, 0.0):+.3f}  "
                  f"fresh={fresh[t]:+.3f}  delta={fresh[t] - shipped.get(t, 0.0):+.3f}")

        in_bucket = ((d["pick"] >= lo) & (d["pick"] <= hi)).to_numpy()
        uncorrected_bias, corrected_bias = {}, {}
        for t in TARGETS:
            p36 = np.full(len(d), np.nan)
            for cls in sorted(d["draft_class"].unique()):
                te = (d["draft_class"] == cls).to_numpy()
                tr = ~te
                y36 = (d.loc[tr, "y_" + t] * 36.0 / d.loc[tr, "mpg"]).to_numpy()
                p36[te] = _fit(d.loc[tr, cols].to_numpy(float), y36).predict(X_all[te]).clip(0, None)
            uncorrected_bias[t] = float(np.mean((true36[t] - p36)[in_bucket]))
            corrected_bias[t] = float(np.mean((true36[t] - p36 - shipped.get(t, 0.0))[in_bucket]))
        print(f"\n  picks {lo}-{hi} bias, uncorrected vs. with shipped correction applied:")
        for t in TARGETS:
            print(f"  {t:5s}  uncorrected={uncorrected_bias[t]:+.3f}  corrected={corrected_bias[t]:+.3f}")


def main() -> None:
    d, cols = load()
    print(f"training rows: {len(d)}  classes: {d['draft_class'].nunique()}"
          f"  features: {len(cols)}  targets: {len(TARGETS)}")

    p2 = loco_predict(d, cols, two_stage=True)
    p1 = loco_predict(d, cols, two_stage=False)
    r2 = report(d, p2, "LOCO CV — TWO-STAGE (minutes x per-36)")
    r1 = report(d, p1, "LOCO CV — DIRECT per-game (baseline)")

    print("\n=== two-stage vs direct: MAE delta (negative = two-stage better) ===")
    cmp = pd.DataFrame({"cat": TARGETS,
                        "two_stage": r2["MAE"].to_numpy(), "direct": r1["MAE"].to_numpy()})
    cmp["delta"] = cmp["two_stage"] - cmp["direct"]
    cmp["pct"] = 100 * cmp["delta"] / cmp["direct"]
    print(cmp.round(3).to_string(index=False))

    pf = forward_chain(d, cols, two_stage=True)
    report(d, pf, "FORWARD-CHAINING (train<=t, test t+1) — the honest number")

    # Stage A quality: minutes drive everything downstream.
    m = p2["mpg"].notna().to_numpy()
    y, yh = d.loc[m, "mpg"].to_numpy(), p2.loc[m, "mpg"].to_numpy()
    print(f"\n=== Stage A (rookie MPG) LOCO ===")
    print(f"  MAE={np.mean(np.abs(y-yh)):.2f} mpg | RMSE={np.sqrt(np.mean((y-yh)**2)):.2f}"
          f" | corr={np.corrcoef(y,yh)[0,1]:.3f} | baseline MAE={np.mean(np.abs(y-y.mean())):.2f}")

    check_bucket_corrections(d, cols)


if __name__ == "__main__":
    main()
