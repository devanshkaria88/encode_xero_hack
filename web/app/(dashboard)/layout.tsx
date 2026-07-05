import * as React from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { ChatWidget } from "@/components/chat/chat-widget";

/**
 * The dashboard shell: a fixed left sidebar (desktop), a top bar with the
 * org/status pill, and the routed surface. Clean and overflow-free at 1280
 * and 1440 stage widths.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas">
      {/* Fixed sidebar on large screens */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-border bg-card lg:block">
        <AppSidebar />
      </aside>

      <div className="flex min-h-screen flex-col lg:pl-64">
        <TopBar />
        <div className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-5 sm:px-6 sm:py-6">
          {/* Extra bottom padding keeps the last card's figures clear of the
              floating chat bubble when a page is scrolled to its end. */}
          <main className="pb-20">{children}</main>
        </div>
      </div>

      {/* Robyn chat: floating bubble + right-side panel, on every page. */}
      <ChatWidget />
    </div>
  );
}
