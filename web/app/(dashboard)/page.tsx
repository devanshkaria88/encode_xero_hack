import type { Metadata } from "next";

import { TasksSurface } from "./tasks/_components/tasks-surface";

export const metadata: Metadata = {
  title: "Tasks inbox",
};

/** Home. The demo opens here: everything Robyn needs a human for. */
export default function HomePage() {
  return <TasksSurface />;
}
