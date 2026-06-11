#!/bin/bash
#
# One-command setup for motion-brand on macOS.
#
# Run from anywhere:
#   bash <(curl -fsSL https://raw.githubusercontent.com/califa/unify-brand-motion/main/scripts/setup.sh)
#
# Or if you already have the repo:
#   npm run setup
#

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${BOLD}$1${NC}"; }
warn()  { echo -e "${YELLOW}$1${NC}"; }
ok()    { echo -e "${GREEN}$1${NC}"; }
fail()  { echo -e "${RED}$1${NC}"; exit 1; }

# ── Require macOS ─────────────────────────────────────────────

[[ "$(uname)" == "Darwin" ]] || fail "This tool requires macOS."

# ── Git / Xcode Command Line Tools ───────────────────────────

if ! git --version &>/dev/null; then
  info "Git not found. Installing Xcode Command Line Tools..."
  info "(A dialog may appear — click 'Install' and wait for it to finish.)"
  xcode-select --install 2>/dev/null || true
  waited=0
  until git --version &>/dev/null; do
    sleep 5
    waited=$((waited + 5))
    if [[ $waited -ge 600 ]]; then
      fail "Xcode CLT installation timed out after 10 minutes. Run 'xcode-select --install' manually, then re-run this script."
    fi
  done
  ok "Xcode CLT installed."
fi

# ── Homebrew ──────────────────────────────────────────────────

if ! command -v brew &>/dev/null; then
  info "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add to path for Apple Silicon
  if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
fi
ok "Homebrew: $(brew --version | head -1)"

# ── Node.js 18+ ──────────────────────────────────────────────

need_node=false
if ! command -v node &>/dev/null; then
  need_node=true
elif [[ $(node -v | cut -d. -f1 | tr -d v) -lt 18 ]]; then
  need_node=true
fi

if $need_node; then
  info "Installing Node.js..."
  brew install node
fi
ok "Node.js: $(node -v)"

# ── ffmpeg ────────────────────────────────────────────────────
# Used for format conversions (MP4, WebM, GIF). The render pipeline
# also bundles its own ffmpeg via @ffmpeg-installer, but system ffmpeg
# is handy for ad-hoc conversions.

if ! command -v ffmpeg &>/dev/null; then
  info "Installing ffmpeg..."
  brew install ffmpeg
fi
ok "ffmpeg: $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')"

# ── Clone or update repo ─────────────────────────────────────

REPO_DIR="${MOTION_BRAND_DIR:-$HOME/vibe/motion-brand}"
REPO_URL="https://github.com/califa/unify-brand-motion.git"

if [[ -d "$REPO_DIR/.git" ]]; then
  info "Updating repo at $REPO_DIR..."
  git -C "$REPO_DIR" pull --ff-only 2>/dev/null || warn "Pull failed — continuing with existing checkout"
else
  info "Cloning to $REPO_DIR..."
  mkdir -p "$(dirname "$REPO_DIR")"
  git clone "$REPO_URL" "$REPO_DIR"
fi

# ── npm install (postinstall patches ffmpeg + installs Chromium) ─

cd "$REPO_DIR"

# Ensure animations/ directory exists (gitignored but needed for scenes)
mkdir -p animations output

info "Installing dependencies..."
if ! npm install 2>&1; then
  fail "npm install failed. Check the output above."
fi

# ── Verify ────────────────────────────────────────────────────

info "Running preflight checks..."
if npx tsx scripts/render.ts --preflight 2>&1; then
  ok "Preflight passed."
else
  warn "Preflight had issues — see output above. Render may still work."
fi

echo ""
ok "Motion Brand is ready!"
echo ""
echo "  Repo:    $REPO_DIR"
echo "  Render:  cd $REPO_DIR && npm run render"
echo "  Preview: cd $REPO_DIR && npm start"
echo ""
echo "  Examples:"
echo "    npm run render                                    # MP4 (default)"
echo "    npm run render -- --format webm --transparent     # WebM with alpha"
echo "    npm run render -- --format gif                    # Animated GIF"
echo "    npm run render -- --output ~/Desktop/logo.mp4     # Custom output path"
echo ""
