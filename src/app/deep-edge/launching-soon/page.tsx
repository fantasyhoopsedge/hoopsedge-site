import {
  FOUNDING_DISCOUNT_PCT,
  FOUNDING_OFFER_END_LABEL,
  FOUNDING_PRICE_USD,
  SEASON_PASS_USD,
  foundingOfferIsOpen,
} from "@/lib/deep-edge/offer";
import { LaunchingSoon } from "../_components/launching-soon";

/**
 * An ADMIN PREVIEW of the founding-price screen. Nothing links here.
 *
 * Every real route resolves its own destination now: /deep-edge sends an admin
 * to the tool and a signed-in non-admin to this same screen (rendered by the
 * layout, not this file), and /the-deep-edge simply points at /deep-edge and
 * lets it decide. This URL briefly WAS the target of those CTAs, which is
 * exactly how an admin ended up being shown "launching soon" for a product
 * they can already use — a hardcoded destination cannot know who is clicking.
 *
 * Kept because the layout's copy of this screen is by definition unreachable
 * for an admin, so without this URL there is no way to see what customers
 * actually see short of editing rb_admins or setting DEEP_EDGE_FORCE_SOON.
 * That makes it a QA surface, not a link target — don't point a CTA here
 * again; point it at /deep-edge.
 */
export default function DeepEdgeLaunchingSoonPage() {
  return (
    <LaunchingSoon
      seasonPassUsd={SEASON_PASS_USD}
      discountPct={FOUNDING_DISCOUNT_PCT}
      foundingPriceUsd={FOUNDING_PRICE_USD}
      offerOpen={foundingOfferIsOpen()}
      offerEndLabel={FOUNDING_OFFER_END_LABEL}
    />
  );
}
