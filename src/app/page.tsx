import React from "react";
import { currentUser } from "@/lib/auth";
import { PhoneFirstEntry } from "@/components/PhoneFirstEntry";
import { Search } from "@/components/Search";
export default async function Home(){const user=await currentUser();return user?<Search/>:<PhoneFirstEntry/>}