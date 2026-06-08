import DocsPage from "@/components/docs-page";
import CodeBlock from "@/components/code-block";
import { getPrevNext } from "@/lib/docs";

export default function GettingStartedPage() {
  const { prev, next } = getPrevNext("/docs/getting-started");

  return (
    <DocsPage
      title="Getting Started"
      description="Install tmax and run your first editing session"
      prevPage={prev}
      nextPage={next}
    >
      <h2>Prerequisites</h2>
      <p>
        tmax requires the <strong>Bun</strong> runtime (v1.0 or later). Bun
        provides the fastest development experience and is the officially
        recommended runtime.
      </p>
      <p>
        Install Bun from{" "}
        <a href="https://bun.sh" target="_blank" rel="noopener noreferrer">
          bun.sh
        </a>{" "}
        if you don&apos;t have it already.
      </p>

      <h2>Install</h2>
      <p>Clone and set up tmax:</p>
      <CodeBlock language="bash" filename="terminal">
        {`git clone https://github.com/mekkamagnus/tmax.git
cd tmax
bun install`}
      </CodeBlock>

      <h3>Binary Distribution (Recommended)</h3>
      <p>
        tmax ships as compiled binaries via GitHub Releases. Download the latest
        for your platform:
      </p>
      <CodeBlock language="bash" filename="terminal">
        {`# macOS (arm64)
curl -fsSL https://github.com/mekkamagnus/tmax/releases/latest/download/tmax-macos-arm64 \\
  -o /usr/local/bin/tmax
chmod +x /usr/local/bin/tmax`}
      </CodeBlock>

      <h3>From Source (Development)</h3>
      <CodeBlock language="bash" filename="terminal">
        {`cd tmax
bun install

# Build binaries
bun run build

# Symlink to /usr/local/bin
./scripts/link.sh`}
      </CodeBlock>

      <h2>First Run</h2>
      <p>Open a file to start editing:</p>
      <CodeBlock language="bash" filename="terminal">
        {`tmax filename.txt`}
      </CodeBlock>
      <p>
        tmax opens in the terminal with a full-screen interface. You start in{" "}
        <strong>normal mode</strong>, which is the command/navigation mode.
      </p>

      <h2>Basic Commands</h2>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>i</code>
            </td>
            <td>Enter insert mode (start typing)</td>
          </tr>
          <tr>
            <td>
              <code>Escape</code>
            </td>
            <td>Return to normal mode</td>
          </tr>
          <tr>
            <td>
              <code>h j k l</code>
            </td>
            <td>Move cursor (left, down, up, right)</td>
          </tr>
          <tr>
            <td>
              <code>q</code>
            </td>
            <td>Quit tmax</td>
          </tr>
          <tr>
            <td>
              <code>:</code>
            </td>
            <td>Enter command mode</td>
          </tr>
          <tr>
            <td>
              <code>SPC ;</code>
            </td>
            <td>Enter M-x mode (execute commands by name)</td>
          </tr>
        </tbody>
      </table>

      <h2>Daemon/Client</h2>
      <p>
        tmax supports an Emacs-style daemon/client architecture. The daemon
        holds all editor state; clients connect as viewports.
      </p>
      <CodeBlock language="bash" filename="terminal">
        {`# Start with a file (auto-starts daemon if needed)
tmax filename.txt

# Evaluate T-Lisp on the daemon
tmax -e '(+ 1 2)'

# Open another file in a new frame
tmax other.txt

# Stop the daemon
tmax --stop`}
      </CodeBlock>
      <p>
        Multiple clients share the same buffers and interpreter state, enabling
        multi-window editing workflows.
      </p>
    </DocsPage>
  );
}
