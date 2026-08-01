"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Moved to /admin, which now has Campaigns/Tickets tabs. */
export default function AdminCampaignsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin");
  }, [router]);
  return null;
}
