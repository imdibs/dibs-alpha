import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ProfileForm } from "@/components/ProfileForm";
import { Chat } from "@/components/Chat";
export default async function ConversationPage({params}:{params:Promise<{id:string}>}){const user=await currentUser();if(!user)return <ProfileForm/>;const {id}=await params;const result=await db().from("conversations").select("*,listing:listings(title),buyer:users!buyer_id(name),seller:users!seller_id(name),deal:deals(agreed_price_cents)").eq("id",id).maybeSingle();const c:any=result.data;if(!c||![c.buyer_id,c.seller_id].includes(user.id))notFound();const other=c.buyer_id===user.id?c.seller.name:c.buyer.name;return <div className="chat"><p className="meta">{c.listing.title}</p><h1>Chat with {other}</h1><Chat conversationId={id} userId={user.id} initialDeal={c.deal?.[0]?.agreed_price_cents}/></div>}