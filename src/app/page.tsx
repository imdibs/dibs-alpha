import { currentUser } from "@/lib/auth";
import { ProfileForm } from "@/components/ProfileForm";
import { Search } from "@/components/Search";
export default async function Home(){const user=await currentUser();return user?<Search/>:<ProfileForm/>}