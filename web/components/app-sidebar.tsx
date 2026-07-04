"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { NAV_ITEMS, isActive } from "@/lib/nav";
import { useApi, type Schemas } from "@/lib/api";
import { Brand } from "@/components/brand";

/** Left navigation for the five surfaces. Home is the Tasks inbox. */
export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  // Open-task count powers the inbox badge. Fails quietly — nav still works.
  const { data: counts } = useApi<Schemas["TaskCountsDto"]>("/tasks/counts", {
    refreshMs: 30_000,
  });
  const openTasks = counts?.total ?? 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Link
          href="/"
          onClick={onNavigate}
          className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Robyn home"
        >
          <Brand />
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;
          const showCount = item.href === "/" && openTasks > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              <Icon
                className={cn(
                  "h-[1.15rem] w-[1.15rem] shrink-0 transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground group-hover:text-foreground",
                )}
              />
              <span className="flex-1 truncate">{item.label}</span>
              {showCount && (
                <span
                  className="tabular inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[0.6875rem] font-semibold text-primary-foreground"
                  aria-label={`${openTasks} open tasks`}
                >
                  {openTasks}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Robyn watches your calendar, contracts and transcripts, then turns the
          gap into invoices in Xero.
        </p>
      </div>
    </div>
  );
}
