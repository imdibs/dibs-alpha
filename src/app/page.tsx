import { currentUser } from "@/lib/auth";
import { ProfileForm } from "@/components/ProfileForm";
import { Search } from "@/components/Search";
export default async function Home(){const user=await currentUser();return user?<Search/>:<><section className="hero"><p className="eyebrow">Miami Alpha</p><h1>Dibs is live in Miami.</h1><p className="muted">Buy and sell through text. We are inviting a small group of Miami locals first.</p></section><ProfileForm/></>}