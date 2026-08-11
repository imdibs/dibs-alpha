import { currentUser } from "@/lib/auth";
import { ProfileForm } from "@/components/ProfileForm";
import { SellForm } from "@/components/SellForm";
export default async function Sell(){const user=await currentUser();if(!user)return <ProfileForm/>;return <div className="panel"><h1>Sell something</h1><p className="muted">Add clear photos and the facts a buyer needs. You can edit with founder support during Alpha.</p><SellForm city={user.city || "Miami, FL"}/></div>}