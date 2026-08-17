import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getPublicListing, publicListingUrl } from "@/lib/public-listings";
import { PublicListingActions } from "@/components/PublicListingActions";

type Props = { params: Promise<{ token: string }> };
const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;
const condition = (value: string) => value === "like_new" ? "Like new" : value.replace(/^./, letter => letter.toUpperCase());

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const listing = await getPublicListing((await params).token);
  if (!listing) return { title: "Listing not found | Dibs" };
  const title = `${listing.title} for ${money(listing.price_cents)} in ${listing.city}`;
  const description = `${condition(listing.condition)}. ${listing.description}`.slice(0, 200);
  const url = publicListingUrl(listing.public_token!);
  return { title, description, alternates: { canonical: url }, openGraph: { type: "website", url, title, description, images: listing.image_urls.slice(0, 1) }, twitter: { card: "summary_large_image", title, description, images: listing.image_urls.slice(0, 1) } };
}

export default async function PublicListingPage({ params }: Props) {
  const listing = await getPublicListing((await params).token);
  if (!listing) notFound();
  const user = await currentUser();
  const active = listing.status === "active";
  return <article className="public-listing">
    <div className="listing-gallery">{listing.image_urls.map((url, index) => <img src={url} alt={`${listing.title}, photo ${index + 1}`} key={url}/>)}</div>
    <div className="listing-details">
      {!active&&<div className="notice">This listing is no longer active.</div>}
      <p className="meta">{condition(listing.condition)} · {listing.city}</p>
      <h1>{listing.title}</h1>
      <div className="price">{money(listing.price_cents)}</div>
      <p>{listing.description}</p>
      <PublicListingActions token={listing.public_token!} title={listing.title} active={active} authenticated={Boolean(user)}/>
    </div>
  </article>;
}