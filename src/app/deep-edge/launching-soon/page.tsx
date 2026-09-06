import { FOUNDING_DISCOUNT_PCT, FOUNDING_PRICE_USD, SEASON_PASS_USD } from "@/lib/deep-edge/waitlist";
import { LaunchingSoon } from "../_components/launching-soon";

/**
 * The founding-price screen at a URL that always shows it.
 *
 * `/deep-edge` itself branches on the admin allowlist and sends an admin
 * straight into the tool, so it is the wrong target for a public "Open The
 * Deep Edge" link — /the-deep-edge points here instead. Sitting inside the
 * /deep-edge subtree is deliberate: this page inherits that layout's gate for
 * free, so a signed-out visitor is still bounced to the launch gateway to
 * sign in, and a signed-in NON-admin is served the layout's own copy of this
 * same screen. The only visitor who reaches THIS file is an admin, who would
 * otherwise never see what everyone else sees.
 */
export default function DeepEdgeLaunchingSoonPage() {
  return (
    <LaunchingSoon
      seasonPassUsd={SEASON_PASS_USD}
      discountPct={FOUNDING_DISCOUNT_PCT}
      foundingPriceUsd={FOUNDING_PRICE_USD}
    />
  );
}
