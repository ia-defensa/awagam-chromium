#!/bin/bash

# AWAGAM Blocklist Validator
# Validates blocklist.json to prevent redundant entries without Node.js dependencies

BLOCKLIST_PATH="$(dirname "$0")/blocklist.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No color

# Check if blocklist.json exists
if [ ! -f "$BLOCKLIST_PATH" ]; then
    echo -e "${RED}❌ Error: blocklist.json not found at $BLOCKLIST_PATH${NC}"
    exit 1
fi

# Check if jq is available
if ! command -v jq &> /dev/null; then
    echo -e "${YELLOW}⚠️  Warning: jq not found. Installing basic validation…${NC}"

    # Basic JSON syntax check
    if ! python3 -m json.tool "$BLOCKLIST_PATH" > /dev/null 2>&1; then
        echo -e "${RED}❌ Error: blocklist.json contains invalid JSON${NC}"
        exit 1
    fi

    echo -e "${GREEN}✅ Basic JSON validation passed${NC}"
    echo -e "${BLUE}💡 Install jq for full redundancy validation: brew install jq${NC}"
    exit 0
fi

echo "🔍 Validating blocklist for redundant entries…"
echo

# Function to extract domain from URL (supports protocol-less URLs)
extract_domain() {
    local url="$1"
    # Remove protocol if present, then extract domain part
    echo "$url" | sed -E 's|^https?://||' | sed -E 's|^([^/]+).*|\1|' | tr '[:upper:]' '[:lower:]'
}

# Function to extract TLD from domain
extract_tld() {
    echo "$1" | sed -E 's/.*(\.[^.]+)$/\1/' | tr '[:upper:]' '[:lower:]'
}

# Function to check if domain is covered by TLD
is_domain_covered_by_tld() {
    local domain="$1"
    local tld="$2"
    local domain_tld=$(extract_tld "$domain")
    [ "$domain_tld" = "$(echo "$tld" | tr '[:upper:]' '[:lower:]')" ]
}

# Function to check if URL is covered by domain
is_url_covered_by_domain() {
    local url="$1"
    local domain="$2"
    local url_domain=$(extract_domain "$url")
    local norm_domain=$(echo "$domain" | tr '[:upper:]' '[:lower:]')

    # Check if URL domain is the same or a subdomain of the blocked domain
    [ "$url_domain" = "$norm_domain" ] || [[ "$url_domain" == *".$norm_domain" ]]
}

has_errors=false

# Validate all groups
groups=$(jq -r 'keys[]' "$BLOCKLIST_PATH" 2>/dev/null)
while IFS= read -r group_key; do
    if [ -z "$group_key" ]; then continue; fi

    group_name=$(jq -r ".\"$group_key\".name" "$BLOCKLIST_PATH")
    echo -e "${BLUE}📍 Checking $group_name ($group_key):${NC}"

    # Get arrays
    tlds=$(jq -r ".\"$group_key\".tlds[]?" "$BLOCKLIST_PATH" 2>/dev/null)
    domains=$(jq -r ".\"$group_key\".domains[]?" "$BLOCKLIST_PATH" 2>/dev/null)
    urls=$(jq -r ".\"$group_key\".urls[]?" "$BLOCKLIST_PATH" 2>/dev/null)

    category_has_errors=false

    # Check if domains are covered by TLDs
    while IFS= read -r domain; do
        if [ -z "$domain" ]; then continue; fi
        while IFS= read -r tld; do
            if [ -z "$tld" ]; then continue; fi
            if is_domain_covered_by_tld "$domain" "$tld"; then
                echo -e "   ${RED}❌ Domain “$domain” is redundant—already covered by TLD “$tld”${NC}"
                has_errors=true
                category_has_errors=true
            fi
        done <<< "$tlds"
    done <<< "$domains"

    # Check if URLs are covered by domains
    while IFS= read -r url; do
        if [ -z "$url" ]; then continue; fi
        while IFS= read -r domain; do
            if [ -z "$domain" ]; then continue; fi
            if is_url_covered_by_domain "$url" "$domain"; then
                echo -e "   ${RED}❌ URL “$url” is redundant—already covered by domain “$domain”${NC}"
                has_errors=true
                category_has_errors=true
            fi
        done <<< "$domains"
    done <<< "$urls"

    # Check if URLs are covered by TLDs
    while IFS= read -r url; do
        if [ -z "$url" ]; then continue; fi
        url_domain=$(extract_domain "$url")
        if [ -n "$url_domain" ]; then
            while IFS= read -r tld; do
                if [ -z "$tld" ]; then continue; fi
                if is_domain_covered_by_tld "$url_domain" "$tld"; then
                    echo -e "   ${RED}❌ URL “$url” is redundant—already covered by TLD “$tld”${NC}"
                    has_errors=true
                    category_has_errors=true
                fi
            done <<< "$tlds"
        fi
    done <<< "$urls"

    if [ "$category_has_errors" = false ]; then
        echo -e "   ${GREEN}✅ No redundant entries found${NC}"
    fi
    echo
done <<< "$groups"

# Final result
if [ "$has_errors" = true ]; then
    echo -e "${RED}❌ Blocklist validation failed—please remove redundant entries before committing${NC}"
    echo
    echo "Tips:"
    echo "• If you want to block a specific domain, check if its TLD isn’t already blocked"
    echo "• If you want to block a specific URL, check if its domain or TLD isn’t already blocked"
    echo "• Consider if you really need the more specific entry, or if the broader block is sufficient"
    exit 1
else
    echo -e "${GREEN}✅ Blocklist validation passed—no redundant entries found${NC}"
fi