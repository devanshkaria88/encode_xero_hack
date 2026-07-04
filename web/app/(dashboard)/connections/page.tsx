import type { Metadata } from "next";

import { ConnectionsSurface } from "./_components/connections-surface";

export const metadata: Metadata = {
  title: "Connections",
};

/**
 * Connections surface — the live, honest health of Robyn's links to Xero, your
 * calendar and your inbox. Integration health is a first-class product screen,
 * not buried config: this is where the reliability story is told.
 */
export default function ConnectionsPage() {
  return <ConnectionsSurface />;
}
