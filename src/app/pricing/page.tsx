import { isCheckoutConfigured } from "@/lib/stripe";
import { PricingView } from "./PricingView";

// read the payment settings per request, so switching Stripe on needs no rebuild of this page
export const dynamic = "force-dynamic";

export default function PricingPage() {
  return <PricingView checkoutAvailable={isCheckoutConfigured()} />;
}
