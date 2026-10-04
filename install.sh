#!/bin/sh
# Install jev for any coding agent: the CLI on PATH, the API key, the skill where agents look for it.
# Overrides: JEV_BIN_DIR (default ~/.local/bin), JEV_SKILLS_DIR (default ~/.agents/skills), JEV_CONFIG.
set -e
root=$(cd "$(dirname "$0")" && pwd)

node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)' 2>/dev/null ||
  { echo "jev needs Node >= 22.18 (found: $(node --version 2>/dev/null || echo none))" >&2; exit 1; }

bindir=${JEV_BIN_DIR:-$HOME/.local/bin}
mkdir -p "$bindir"
ln -sf "$root/bin/jev" "$bindir/jev"
echo "cli:   $bindir/jev"
case ":$PATH:" in *":$bindir:"*) ;; *) echo "       add $bindir to your PATH" ;; esac

config=${JEV_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/jev/env}
if [ -n "$TYPESAFE_API_KEY$OPENROUTER_API_KEY" ] || [ -f "$config" ]; then
  echo "key:   found"
else
  "$root/bin/jev" setup || echo "key:   none yet, run jev setup before the first call"
fi

skills=${JEV_SKILLS_DIR:-$HOME/.agents/skills}
mkdir -p "$skills"
if [ -e "$skills/jev" ] && [ ! -L "$skills/jev" ]; then
  echo "skill: $skills/jev exists and is not a link, left as is"
else
  ln -sfn "$root/skills/jev" "$skills/jev"
  echo "skill: $skills/jev"
fi

cat <<EOF

Codex and other agents that read ~/.agents/skills now see the jev skill.
Claude Code: install the plugin for the skill, jev on the Bash PATH, and the compaction hook:
  claude plugin marketplace add Duttonn/agentic-jev
  claude plugin install jev@agentic-jev
Any other agent: paste $root/AGENTS.snippet.md into its instructions file (AGENTS.md, .cursor/rules, ...).
Check: jev ask -s hello -q '{"greeting":{"type":"noul","instructions":"Is \`text\` a greeting?"}}'
EOF
