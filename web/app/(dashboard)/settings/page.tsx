import type { Metadata } from "next";

import { SettingsSurface } from "./_components/settings-surface";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * Settings surface — how Robyn's chat agent behaves: its standing
 * instructions, the model it runs on, and the tools it may reach for.
 */
export default function SettingsPage() {
  return <SettingsSurface />;
}
