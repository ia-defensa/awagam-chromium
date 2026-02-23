#!/bin/bash

# Install git hooks for AWAGAM development
echo "Installing git hooks…"

# Check if we’re in a git repository
if [ ! -d ".git" ]; then
    echo "❌ Error: Not in a git repository"
    exit 1
fi

# Create hooks directory if it doesn’t exist
mkdir -p .git/hooks

# Copy pre-commit hook
cp git-hooks/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit

echo "✅ Git hooks installed successfully"
echo "The pre-commit hook will now validate blocklist.json before each commit."