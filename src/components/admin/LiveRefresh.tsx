"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export const ADMIN_REFRESH_INTERVAL_MS = 5_000;

export function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    const interval = window.setInterval(() => router.refresh(), ADMIN_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [router]);

  return null;
}