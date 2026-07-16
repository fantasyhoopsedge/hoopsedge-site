"""Ablations + band calibration.

Two questions this answers:

1. Does college play add anything over the draft pick? Engelmann found pick is the
   strongest single predictor and that its importance GROWS at higher outcome tiers.
   If a pick-only model matches the full model, the honest conclusion is that this
   artifact mostly restates the market — which matters for FHE's "value first,
   number second" positioning, not just for accuracy.

2. Do the article's per-category asymmetry claims reproduce on fantasy box-score
   targets? Claims under test: STL is floor-informative / ceiling-weak, BLK is the
   reverse, FT%/FG% are the most stable translating skills. We fit quantile
   regressions and let the data answer rather than hand-encoding band widths.

Run: python models/rookie-translation/ablations.py
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.linear_model import QuantileRegressor, Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from train import TARGETS, ALPHA, load

PICK_ONLY = ["f_log_pick"]


def loco_mae(d: pd.DataFrame, cols: list[str], target: str) -> float:
    X = d[cols].to_numpy(float)
    y = d["y_" + target].to_numpy()
    pred = np.full(len(d), np.nan)
    for cls in sorted(d["draft_class"].unique()):
        te = (d["draft_class"] == cls).to_numpy()
        m = make_pipeline(StandardScaler(), Ridge(alpha=ALPHA))
        m.fit(X[~te], y[~te])
        pred[te] = m.predict(X[te]).clip(0, None)
    return float(np.mean(np.abs(y - pred)))


def pinball(y, q, tau):
    e = y - q
    return float(np.mean(np.maximum(tau * e, (tau - 1) * e)))


def loco_quantile(d: pd.DataFrame, cols: list[str], target: str, tau: float) -> np.ndarray:
    X = d[cols].to_numpy(float)
    y = d["y_" + target].to_numpy()
    pred = np.full(len(d), np.nan)
    for cls in sorted(d["draft_class"].unique()):
        te = (d["draft_class"] == cls).to_numpy()
        m = make_pipeline(StandardScaler(),
                          QuantileRegressor(quantile=tau, alpha=0.01, solver="highs"))
        m.fit(X[~te], y[~te])
        pred[te] = m.predict(X[te]).clip(0, None)
    return pred


def main() -> None:
    d, cols = load()
    college_only = [c for c in cols if c != "f_log_pick"]

    print("=== ABLATION: LOCO MAE by feature set (lower is better) ===")
    rows = []
    for t in TARGETS:
        full = loco_mae(d, cols, t)
        pick = loco_mae(d, PICK_ONLY, t)
        coll = loco_mae(d, college_only, t)
        base = float(np.mean(np.abs(d["y_" + t] - d["y_" + t].mean())))
        rows.append({"cat": t, "mean_base": base, "pick_only": pick,
                     "college_only": coll, "full": full,
                     "full_vs_pick_%": 100 * (full - pick) / pick})
    ab = pd.DataFrame(rows)
    print(ab.round(3).to_string(index=False))
    print("\n  full_vs_pick_% < 0 means college data improves on draft pick alone.")
    print(f"  mean improvement of full over pick-only: {ab['full_vs_pick_%'].mean():.2f}%")
    print(f"  categories where college beats pick-only: "
          f"{int((ab['full_vs_pick_%'] < 0).sum())}/{len(ab)}")

    print("\n=== BAND ASYMMETRY: quantile fits (pinball loss, lower is better) ===")
    print("  skill_% = improvement over an unconditional quantile of the training data.")
    rows = []
    for t in TARGETS:
        y = d["y_" + t].to_numpy()
        r = {"cat": t}
        for tau in (0.10, 0.50, 0.90):
            q = loco_quantile(d, cols, t, tau)
            uncond = np.quantile(y, tau)
            skill = 100 * (1 - pinball(y, q, tau) / pinball(y, np.full_like(y, uncond), tau))
            r[f"q{int(tau*100)}_skill_%"] = skill
        rows.append(r)
    qa = pd.DataFrame(rows)
    qa["floor_minus_ceiling"] = qa["q10_skill_%"] - qa["q90_skill_%"]
    print(qa.round(2).to_string(index=False))

    print("\n=== article claims vs this data ===")
    stl = qa[qa["cat"] == "stl"].iloc[0]
    blk = qa[qa["cat"] == "blk"].iloc[0]
    print(f"  STL: q10 skill={stl['q10_skill_%']:.1f}%  q90 skill={stl['q90_skill_%']:.1f}%"
          f"  -> floor-informative? {stl['q10_skill_%'] > stl['q90_skill_%']}")
    print(f"  BLK: q10 skill={blk['q10_skill_%']:.1f}%  q90 skill={blk['q90_skill_%']:.1f}%"
          f"  -> ceiling-informative? {blk['q90_skill_%'] > blk['q10_skill_%']}")
    print("  (article: STL good floor / weak ceiling; BLK the reverse)")


if __name__ == "__main__":
    main()
