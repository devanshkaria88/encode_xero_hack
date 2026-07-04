"use client";

import * as React from "react";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { AppSidebar } from "@/components/app-sidebar";
import { Brand } from "@/components/brand";
import { ModeToggle } from "@/components/mode-toggle";
import { OrgStatusPill } from "@/components/org-status-pill";

/**
 * Top bar over the content area: mobile nav trigger + Robyn wordmark (mobile),
 * and on the right the org/status pill and theme toggle.
 */
export function TopBar() {
  const [open, setOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-canvas/80 px-4 backdrop-blur-md sm:px-6">
      {/* Mobile menu */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <AppSidebar onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Brand shows on mobile where the sidebar is hidden */}
      <div className="lg:hidden">
        <Brand size="sm" />
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <OrgStatusPill />
        <ModeToggle />
      </div>
    </header>
  );
}
