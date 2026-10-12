import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireSession } from "@/lib/db/session";

export const metadata: Metadata = { title: "Presentation" };

// Full-screen routes without the app shell. Pages re-check the session themselves too
// (layouts and pages render in parallel).
export default async function PresentLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return children;
}
