import { requireAdmin } from "@/lib/admin-auth";
import "./admin.css";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireAdmin();
  return <div className="mission-control">{children}</div>;
}