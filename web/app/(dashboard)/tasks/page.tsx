import type { Metadata } from "next";

import { TasksSurface } from "./_components/tasks-surface";

export const metadata: Metadata = {
  title: "Tasks inbox",
};

/** The Tasks inbox at /tasks. The same surface is mounted at "/" (home). */
export default function TasksRoutePage() {
  return <TasksSurface />;
}
