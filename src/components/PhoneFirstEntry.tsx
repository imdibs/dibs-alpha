import React from "react";
import { cookies } from "next/headers";
import { validOriginListingToken, validTrackingToken } from "@/lib/tracking";
import { PhoneFirstOnboarding } from "./PhoneFirstOnboarding";

export async function PhoneFirstEntry({ originatingListing }: { originatingListing?: string } = {}) {
  const cookieStore = await cookies();
  const visitorId = validTrackingToken(cookieStore.get("dibs_visitor")?.value) || undefined;
  const attributionId = validTrackingToken(cookieStore.get("dibs_attribution")?.value) || undefined;
  const listing = validOriginListingToken(originatingListing)
    || validOriginListingToken(cookieStore.get("dibs_origin_listing")?.value)
    || undefined;
  return <PhoneFirstOnboarding visitorId={visitorId} attributionId={attributionId} originatingListing={listing}/>;
}