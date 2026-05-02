# tmax Installation Guide

tmax is an extensible terminal-based text editor with T-Lisp scripting capabilities. This guide covers all installation methods.

## Quick Install (Recommended)

### Using Bun (Fastest)
```bash
bun add -g tmax
```

### Using npm
```bash
npm install -g tmax
```

This installs tmax globally on your system, making the `tmax` command available everywhere.

## Alternative Installation Methods

### From Source (Development)

If you want to contribute or run the latest development version:

```bash
# Clone the repository
git clone https://github.com/mekkamagnus/tmax.git
cd tmax

# Install dependencies
bun install

# Run directly
bun run src/main.tsx

# Or link globally for development
bun link
```

### Using the Launcher Script

After cloning the repository:

```bash
# Make the launcher executable
chmod +x bin/tmax

# Add to PATH (optional)
export PATH="$(pwd)/bin:$PATH"

# Run
./bin/tmax
```

## Installation Locations

When installed globally via npm or bun:

| Platform | Installation Path |
|----------|-------------------|
| macOS (Homebrew) | `/opt/homebrew/bin/tmax` |
| macOS (npm/bun) | `~/.bun/bin/tmax` or `~/.npm-global/bin/tmax` |
| Linux | `~/.bun/bin/tmax` or `~/.local/bin/tmax` |
| Windows | `%APPDATA%\npm\tmax` |

**Note:** Make sure the installation directory is in your PATH.

## Verifying Installation

After installation, verify that tmax is working:

```bash
tmax --version
# Should output: tmax v0.2.0 (T-Lisp powered terminal editor)

tmax --help
# Shows usage information
```

## Platform-Specific Notes

### macOS

**Homebrew users:** The bun/npm installation path may not be in your default PATH. Add this to your `~/.zshrc` or `~/.bash_profile`:

```bash
export PATH="$HOME/.bun/bin:$PATH"  # For Bun
export PATH="$HOME/.npm-global/bin:$PATH"  # For npm
```

**Quarantine Warning:** On first run, macOS may show a security warning. This is because tmax is downloaded from the internet. To dismiss:

```bash
xattr -d com.apple.quarantine $(which tmax)
```

### Linux

No special considerations. Most Linux distributions work out of the box.

### Windows

Windows support is planned but not yet available. Use WSL (Windows Subsystem for Linux) in the meantime.

## System Requirements

- **Bun** 1.0 or later (recommended) OR
- **Node.js** 18+ (with npm)

Bun is strongly recommended for the best performance and compatibility.

## Uninstalling

To remove tmax from your system:

```bash
# If installed via Bun
bun remove -g tmax

# If installed via npm
npm uninstall -g tmax

# If installed from source
rm -rf /path/to/tmax
```

## Configuration

tmax looks for configuration in `~/.config/tmax/init.tlisp`. Create this file to customize your editor:

```lisp
;; Custom key bindings
(key-bind "w" "(cursor-move (+ (cursor-line) 5) (cursor-column))" "normal")

;; Custom function
(defun center-cursor ()
  (let ((line-count (buffer-line-count))
        (center-line (/ line-count 2)))
    (cursor-move center-line 0)))

(key-bind "zz" "(center-cursor)" "normal")
```

## Getting Help

- **Quick help:** Run `tmax --help`
- **T-Lisp API:** See [README.md](../README.md#t-lisp-editor-api)
- **Contributing:** See [CONTRIBUTING.md](contributing/CONTRIBUTING.md)
- **Troubleshooting:** See [TROUBLESHOOTING.md](../TROUBLESHOOTING.md)

## Next Steps

After installing tmax:

1. **Start the editor:** `tmax`
2. **Open a file:** `tmax file.txt`
3. **Learn the basics:** Press `i` to enter insert mode, `Escape` to return to normal mode
4. **Quit:** Press `q` in normal mode
5. **Get help:** Press `:` then type `help` and press Enter

For more information, see the [main README](../README.md).
