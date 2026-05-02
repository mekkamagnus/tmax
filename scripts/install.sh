#!/bin/bash
# tmax Installation Script
# Installs pre-compiled tmax binary from GitHub releases

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REPO="mekkamagnus/tmax"
VERSION="${TMAX_VERSION:-latest}"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
PREFIX="${PREFIX:-}"

# Functions
info() { echo -e "${BLUE}ℹ️${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
error_msg() { echo -e "${RED}✗${NC} $1"; exit 1; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }

# Detect platform
detect_platform() {
    local os="$(uname -s)"
    local arch="$(uname -m)"

    case "$os" in
        Darwin)
            OS="macos"
            if [[ "$arch" == "arm64" ]]; then
                ARCH="arm64"
            elif [[ "$arch" == "x86_64" ]]; then
                ARCH="x64"
            else
                error_msg "Unsupported architecture: $arch"
            fi
            ;;
        Linux)
            OS="linux"
            if [[ "$arch" == "x86_64" ]]; then
                ARCH="x64"
            elif [[ "$arch" == "aarch64" ]]; then
                ARCH="arm64"
            else
                error_msg "Unsupported architecture: $arch"
            fi
            ;;
        *)
            error_msg "Unsupported OS: $os"
            ;;
    esac

    BINARY_NAME="tmax-$OS-$ARCH"
    info "Detected platform: $OS ($ARCH)"
}

# Get latest version from GitHub
get_version() {
    if [[ "$VERSION" == "latest" ]]; then
        VERSION=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
        if [[ -z "$VERSION" ]]; then
            error_msg "Failed to fetch latest version"
        fi
    fi
    success "Version: $VERSION"
}

# Check if installation directory is writable
check_install_dir() {
    if [[ -n "$PREFIX" ]]; then
        INSTALL_DIR="$PREFIX"
    fi

    if [[ ! -d "$INSTALL_DIR" ]]; then
        warn "Installation directory does not exist: $INSTALL_DIR"
        read -p "Create it? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            mkdir -p "$INSTALL_DIR" || sudo mkdir -p "$INSTALL_DIR"
        else
            error_msg "Installation cancelled"
        fi
    fi

    if [[ ! -w "$INSTALL_DIR" ]] && [[ -z "$PREFIX" ]]; then
        warn "No write permission to $INSTALL_DIR"
        INSTALL_DIR="$HOME/.local/bin"
        mkdir -p "$INSTALL_DIR"
        info "Installing to $INSTALL_DIR instead"
        info "Add to PATH: export PATH=\"\$HOME/.local/bin:\$PATH\""
    fi
}

# Download binary
download_binary() {
    local temp_dir=$(mktemp -d)
    local binary_path="$temp_dir/$BINARY_NAME"
    local download_url="https://github.com/$REPO/releases/download/$VERSION/$BINARY_NAME"

    info "Downloading from: $download_url"

    if curl -fsSL "$download_url" -o "$binary_path"; then
        success "Downloaded $BINARY_NAME"
    else
        error_msg "Failed to download binary"
    fi

    # Verify checksum if available
    local checksums_url="https://github.com/$REPO/releases/download/$VERSION/SHA256SUMS"
    local checksums_path="$temp_dir/SHA256SUMS"

    if curl -fsSL "$checksums_url" -o "$checksums_path" 2>/dev/null; then
        info "Verifying checksum..."
        cd "$temp_dir"
        if sha256sum -c "SHA256SUMS" 2>/dev/null | grep -q "$BINARY_NAME: OK"; then
            success "Checksum verified"
        else
            warn "Checksum verification failed (continuing anyway)"
        fi
        cd - > /dev/null
    fi

    # Install binary
    info "Installing to $INSTALL_DIR/tmax"
    mv "$binary_path" "$INSTALL_DIR/tmax" || sudo mv "$binary_path" "$INSTALL_DIR/tmax"
    chmod +x "$INSTALL_DIR/tmax"

    # Cleanup
    rm -rf "$temp_dir"
}

# Show installation summary
show_summary() {
    echo ""
    printf '%.0s' "─"{1..50}
    echo ""
    success "tmax $VERSION installed successfully!"
    echo ""
    echo "  Binary: $INSTALL_DIR/tmax"
    echo "  Config: ~/.config/tmax/init.tlisp"
    echo ""
    echo "Get started:"
    echo "  tmax                    # Start editor"
    echo "  tmax file.txt          # Edit file"
    echo "  tmax --help            # Show help"
    echo ""
    if [[ "$INSTALL_DIR" == "$HOME/.local/bin" ]]; then
        echo "⚠️  Add to PATH if needed:"
        echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
        echo ""
    fi
    printf '%.0s' "─"{1..50}
    echo ""
}

# Main installation
main() {
    echo "🚀 tmax Installation Script"
    echo ""

    detect_platform
    get_version
    check_install_dir
    download_binary
    show_summary
}

main "$@"
