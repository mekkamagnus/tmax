import DocsSidebar from "@/components/docs-sidebar";
import DocsSearch from "@/components/docs-search";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-6xl mx-auto px-6 pt-24 lg:pt-8 pb-16">
        <div className="flex gap-8">
          {/* Desktop sidebar */}
          <div className="hidden lg:block w-64 shrink-0">
            <div className="sticky top-8 space-y-6">
              <DocsSearch />
              <DocsSidebar />
            </div>
          </div>
          {/* Mobile search */}
          <div className="lg:hidden mb-4">
            <DocsSearch />
          </div>
          {/* Content */}
          <main className="flex-1 min-w-0">
            {/* Mobile sidebar (renders its own toggle) */}
            <div className="lg:hidden">
              <DocsSidebar />
            </div>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
