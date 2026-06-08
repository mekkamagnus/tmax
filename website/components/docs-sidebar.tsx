"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { sidebarSections } from "@/lib/docs";

export default function DocsSidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebar = (
    <nav className="space-y-6">
      {sidebarSections.map((section) => {
        const sectionPage = section.pages[0];
        const sectionHref = sectionPage?.href;
        const isSectionActive = sectionHref && pathname === sectionHref;
        return (
          <div key={section.title}>
            <Link
              href={sectionHref || "#"}
              onClick={() => setMobileOpen(false)}
              className={`block text-xs font-semibold uppercase tracking-wider mb-2 transition-colors ${
                isSectionActive
                  ? "text-zinc-200"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {section.title}
            </Link>
            <ul className="space-y-1">
              {section.pages.map((page) => {
                const isActive = pathname === page.href;
                const isSolePage = section.pages.length === 1 && page.title === section.title;
                return (
                  <li key={page.href}>
                    {!isSolePage && (
                      <Link
                        href={page.href}
                        onClick={() => setMobileOpen(false)}
                        className={`block text-sm px-3 py-1.5 rounded-md transition-colors ${
                          isActive
                            ? "bg-accent/10 text-accent font-medium"
                            : "text-zinc-400 hover:text-white hover:bg-white/5"
                        }`}
                      >
                        {page.title}
                      </Link>
                    )}
                    {isActive && page.headings && page.headings.length > 0 && (
                      <ul
                        className={`space-y-0.5 border-l border-white/10 pl-3 ${
                          isSolePage ? "" : "mt-1 ml-3"
                        }`}
                      >
                        {page.headings.map((h) => (
                          <li key={h.id}>
                            <a
                              href={`${page.href}#${h.id}`}
                              onClick={() => setMobileOpen(false)}
                              className="block text-xs text-zinc-500 hover:text-zinc-300 py-1 transition-colors"
                            >
                              {h.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed bottom-4 right-4 z-40 bg-surface border border-white/10 rounded-lg p-3 text-zinc-400 hover:text-white transition-colors"
        aria-label="Toggle docs navigation"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          {mobileOpen ? (
            <path d="M18 6L6 18M6 6l12 12" />
          ) : (
            <>
              <path d="M3 12h18M3 6h18M3 18h18" />
            </>
          )}
        </svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-black/60"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky top-16 lg:top-0 left-0 z-30 lg:z-0 h-[calc(100vh-4rem)] lg:h-[calc(100vh)] w-64 bg-surface lg:bg-transparent border-r border-white/5 lg:border-r-0 p-6 overflow-y-auto transform transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {sidebar}
      </aside>
    </>
  );
}
