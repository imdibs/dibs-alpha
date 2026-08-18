import { currentUser } from "@/lib/auth";
import { PhoneFirstEntry } from "@/components/PhoneFirstEntry";
import { SellForm } from "@/components/SellForm";
export default async function Sell(){const user=await currentUser();if(!user)return <PhoneFirstEntry/>;return <div className="panel"><h1>Sell something</h1><p className="muted">Add clear photos and the facts a buyer needs. You can edit with founder support during Alpha.</p><SellForm city={user.city || "Miami, FL"}/></div>}