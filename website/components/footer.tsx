export default function Footer() {
  return (
    <footer className="border-t border-white/5 py-12 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <span className="font-mono font-semibold text-accent">tmax</span>
            <span className="text-sm text-zinc-500">
              The Extensible Terminal Editor
            </span>
          </div>

          <div className="flex items-center gap-6 text-sm text-zinc-500">
            <a
              href="https://github.com/mekkamagnus/tmax"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent transition-colors"
            >
              GitHub
            </a>
            <span className="text-zinc-700">·</span>
            <span>MIT License</span>
            <span className="text-zinc-700">·</span>
            <span>v0.2.0</span>
          </div>
        </div>

        <div className="text-center mt-8">
          <p className="text-xs text-zinc-600">
            © {new Date().getFullYear()} Mekael Turner. Built with Next.js.
          </p>
        </div>
      </div>
    </footer>
  );
}
