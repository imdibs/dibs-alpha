import { LiveRefresh } from "@/components/admin/LiveRefresh";
import { requireLocalAdmin } from "@/lib/local-admin";
import "./admin.css";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireLocalAdmin();
  return <div className="mission-control"><LiveRefresh/>{children}</div>;
}