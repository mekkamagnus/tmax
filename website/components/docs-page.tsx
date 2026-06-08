import Link from "next/link";
import { type DocPage } from "@/lib/docs";

interface DocsPageProps {
  title: string;
  description: string;
  children: React.ReactNode;
  prevPage?: DocPage | null;
  nextPage?: DocPage | null;
}

export default function DocsPage({
  title,
  description,
  children,
  prevPage,
  nextPage,
}: DocsPageProps) {
  return (
    <div className="max-w-3xl">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">{title}</h1>
        <p className="text-zinc-400 text-lg">{description}</p>
      </header>

      <div className="prose prose-invert prose-headings:text-white prose-a:text-accent prose-code:text-accent prose-pre:bg-[#0d1117] max-w-none">
        {children}
      </div>

      {(prevPage || nextPage) && (
        <nav className="flex items-center justify-between mt-16 pt-6 border-t border-white/10">
          {prevPage ? (
            <Link
              href={prevPage.href}
              className="text-sm text-zinc-400 hover:text-accent transition-colors"
            >
              ← {prevPage.title}
            </Link>
          ) : (
            <span />
          )}
          {nextPage ? (
            <Link
              href={nextPage.href}
              className="text-sm text-zinc-400 hover:text-accent transition-colors"
            >
              {nextPage.title} →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
