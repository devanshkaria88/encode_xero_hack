import type { Metadata } from "next";

import { HomeSurface } from "./tasks/_components/home-surface";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * Home. The demo opens here: headline stats, the money charts board, and the
 * compact inbox of everything Robyn needs a human for.
 */
export default function HomePage() {
  return <HomeSurface />;
}
