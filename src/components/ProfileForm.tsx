"use client";
import { useState } from "react";

export function ProfileForm() {
  const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError("");const form=new FormData(e.currentTarget);const response=await fetch("/api/session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(form))});const data=await response.json();if(!response.ok){setError(data.error);setBusy(false);return}const origin=new URLSearchParams(location.search).get("from");location.href=origin?`/l/${encodeURIComponent(origin)}`:location.pathname}
  return <div className="panel"><h1>Join the Miami Alpha</h1><p className="muted">Create a profile or sign in with the same details. Dibs Alpha is invite-only and 18+.</p><form onSubmit={submit}><label>Name</label><input name="name" required maxLength={80}/><label>Email</label><input name="email" type="email" required/><label>Password</label><input name="password" type="password" minLength={8} maxLength={128} required/><label>Miami area</label><input name="city" placeholder="Brickell, Wynwood, Coral Gables..." required/>{error&&<p className="error">{error}</p>}<p><button disabled={busy}>{busy?"Joining...":"Continue"}</button></p></form></div>
}