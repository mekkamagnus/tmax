interface CodeBlockProps {
  children: string;
  language?: string;
  filename?: string;
}

export default function CodeBlock({
  children,
  language = "",
  filename,
}: CodeBlockProps) {
  const lines = children.trim().split("\n");

  return (
    <div className="my-6 rounded-lg overflow-hidden border border-white/10">
      {filename && (
        <div className="bg-white/5 px-4 py-2 text-xs text-zinc-400 border-b border-white/10 font-mono">
          {filename}
        </div>
      )}
      <div className="bg-[#0d1117] p-4 overflow-x-auto">
        <pre className="text-sm leading-relaxed">
          <code className="font-mono text-zinc-300">
            {lines.map((line, i) => (
              <div key={i} className="flex">
                <span className="inline-block w-8 text-right mr-4 text-zinc-600 select-none text-xs leading-relaxed">
                  {i + 1}
                </span>
                <span className="flex-1">{line}</span>
              </div>
            ))}
          </code>
        </pre>
      </div>
      {language && (
        <div className="bg-white/5 px-4 py-1 text-[10px] text-zinc-500 border-t border-white/10 font-mono uppercase">
          {language}
        </div>
      )}
    </div>
  );
}
