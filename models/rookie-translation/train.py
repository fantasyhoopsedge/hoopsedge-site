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

from common import DRAFT_MODEL_CSV, TRAIN_TABLE
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


if __name__ == "__main__":
    main()
