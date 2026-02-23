# AWAGAM TLD, Domain, and URL Blocker

[![Steady](https://badgen.net/static/support/this%20project/black)](https://steady.page/en/meiert) [![Buy Me a Coffee](https://badgen.net/static/support/this%20project/pink?icon=buymeacoffee)](https://buymeacoffee.com/meiert)

A Chromium browser extension that blocks access to TLDs, domains, and URLs via user-configurable blocklists. Designed for use against actors engaged in wars, genocides, and misanthropy, but effective in blocking anything.

**[Create your own blocklist](#blocklist-format) (it’s easy) or [use an existing blocklist](#blocklists)!**

[![Example of example.com being blocked by AWAGAM in Opera.](example.png)](https://chromewebstore.google.com/detail/awagam/efnpgpiffjglnijemnmdkemiliiialbm)

## Installation

1. [**Go to the extension**](https://chromewebstore.google.com/detail/awagam/efnpgpiffjglnijemnmdkemiliiialbm) in the Chrome Web Store
2. **Click “Add to Chrome”** (or equivalent for other Chromium browsers)

### Locally

1. **Download** or clone this repository
2. **Open Chrome** and navigate to `chrome://extensions/` (or equivalent in other Chromium browsers)
3. **Enable Developer mode** (top right toggle)
4. **Click “Load unpacked”** and select the extension directory
5. **Pin the extension** to your toolbar for easy access

Tip: Also enable the extension in private mode (“Allow in Incognito”).

## Usage

1. **Click “Manage blocklists”** in popup
2. **Add new blocklist** (URL to a valid AWAGAM JSON file)
3. **Configure update settings**
4. **Set update interval** and enable/disable as needed
5. **Monitor status** and rule counts in real-time
6. **Import/export** configurations for backup

## Blocklists

Get started by using one or more community and sample blocklists:

* [Individual countries](https://github.com/j9t/awagam-blocklists/tree/main?tab=readme-ov-file#countries) – block country-specific TLDs
* [**Russia** (invasion of Ukraine)](https://pastebin.com/AjPpQK1p) (use [“raw” URL](https://pastebin.com/raw/AjPpQK1p) for blocklist) (anonymous contribution) – blocks 3 TLDs, 51 domains, 14 URLs (as of Aug 2025)
* [**Israel** (genocide against Palestine and wars against Islamic countries)](https://pastebin.com/Cf5YCjg2) (use [“raw” URL](https://pastebin.com/raw/Cf5YCjg2) for blocklist) (anonymous contribution) – blocks 3 TLDs, 163 domains, 193 URLs (as of Oct 2025)
  - [**Israel** extended fork](https://gitlab.com/ehud48/blocklist/-/blob/main/blocklist.json?ref_type=heads) ([“raw”](https://gitlab.com/ehud48/blocklist/-/raw/main/blocklist.json)) (anonymous contribution) – blocks 3 TLDs, 163 domains, 198 URLs (as of Oct 2025)
* [**Hate groups and far-right parties**](https://pastebin.com/jMvCL5bN) (use [“raw” URL](https://pastebin.com/raw/jMvCL5bN) for blocklist) (anonymous contribution) – blocks 0 TLDs, 18 domains, 6 URLs (as of Aug 2025)
* [Original sample blocklists](https://github.com/j9t/awagam-sample-blocklists)
* [**Yours?**](https://codeberg.org/j9t/awagam/pulls)

(Community contributions are only scanned, yet may be declined for any reason. Community blocklists are listed to provide examples, not to endorse their content. It’s on each extension user to decide what to block and, therefore, what blocklists to use.)

### Blocklist Converter

There’s [an experimental converter](https://hell.meiert.org/awagam/) that allows to convert EasyList blocklists (Adblock, uBlock Origin) to AWAGAM format, and vice-versa. Note that these extensions do _not_ do the same thing—AdBlock and uBlock Origin are _content_ blockers, whereas AWAGAM also blocks navigating to TLDs, domains, and URLs directly.

Please use this AWAGAM code repository to [report issues](https://codeberg.org/j9t/awagam/issues) as well.

## Features

### Core Blocking

* **Built-in blocklist** with TLDs, domains, and URLs organized by groups (currently a placeholder for easier local development)
* **Dynamic rule generation** using Chromium’s declarativeNetRequest API
* **Comprehensive blocking** of all resource types (pages, images, scripts, style sheets, fonts, media, requests)
* **Real-time blocking** without content script overhead
* **Visual indicators**—highlights blocked links with “🛑” icons
* **Punycode support** for internationalized domains
* **Smart allocation system** prioritizes TLDs > domains > URLs to maximize blocking coverage within browser limits

### Blocklists

* **Add multiple blocklists** from any HTTPS URL
* **GitHub integration** with automatic URL conversion and fallbacks
* **Auto-update system** with configurable intervals (1 hour to 1 week)
* **Format validation** and comprehensive error handling
* **Import/export** configurations for backup and sharing
* **Smart caching** with ETag support and fallback mechanisms
* **Dynamic browser limits** detected automatically (e.g., 30,000 rules in Chrome 121+, 5,000 in earlier versions)

### User Interface

* **Popup controls** for quick enable/disable and statistics
* **Temporary disable** options (5 mins, 15 mins, 1 hour)
* **Options page** for complete blocklist management
* **Status indicators** with detailed, non-truncated error messages
* **UI notifications** instead of intrusive alert dialogs
* **Limit warnings** when total rules exceed browser capacity

### Privacy and Security

* **No tracking** or analytics collection
* **Local storage only** for configurations and cache
* **No external API calls** except for configured blocklists
* **Open source** for transparency and security review
* **Cross-device sync** via Chrome storage API

### Browser Compatibility

* **Chrome 88+** (Manifest V3 support required)
* **Chromium-based browsers** (Edge, Brave, Vivaldi, Opera)
* **Requires declarativeNetRequest API** support

## Blocklist Format

Blocklists must use the AWAGAM JSON format:

```json
{
  "group-id": {
    "name": "Human-readable group name",
    "context": "Optional description or context URL(s)",
    "tlds": [
      ".example"
    ],
    "domains": [
      "example.com",
      "example.org"
    ],
    "urls": [
      "https://example.net/foo",
      "example.com/ads/*",
      "example.com/*?affiliate="
    ]
  }
}
```

### URL Formats

AWAGAM supports flexible URL blocking:

* **Full URLs**: `https://example.com/path` (blocks both `http://` and `https://`)
* **Protocol-agnostic**: `example.com/path` (blocks both `http://` and `https://`)
* **Wildcards**: `example.com/*?param=` (use `*` to match any characters)
* **Query parameters**: `site.com/?tracking=` (blocks URLs with specific parameters)

Examples:

* `example.com/*?affiliate=` blocks all URLs on example.com with `?affiliate=` parameter
* `example.com/ads/*` blocks all paths under `/ads/` on example.com
* Both HTTP and HTTPS protocols are always blocked for security

### Format Requirements

* **HTTPS URLs only** for security
* **Valid JSON structure** with proper UTF-8 encoding
* **Domain validation** prevents malformed entries (supports IDNs and partial IP patterns)
* **Size limits** (10 MB max) for performance
* **Rule limits** vary by browser version
* **Rate limiting** and timeout protection

## Technical Details

### Architecture

* **Manifest V3** extension for modern Chromium browsers
* **Service worker** background script with no persistent background
* **Dynamic rules** via declarativeNetRequest API
* **Smart caching** with ETag support and expiration
* **Cross-device sync** via Chrome storage API

### File Structure

```
awagam/
├── manifest.json          # Extension manifest (v3)
├── background.js          # Service worker with rule management
├── popup.html/js          # Extension popup interface
├── options.html/js        # Blocklist management UI
├── content.js             # Content script for link highlighting
├── storage-manager.js     # Storage abstraction layer
├── blocklist-fetcher.js   # External URL fetching with fallbacks
├── blocklist.json         # Built-in blocklist data
└── images/                # Extension icons
```

### Security Features

* **HTTPS-only URLs** prevent man-in-the-middle attacks
* **Private network blocking** prevents internal URL access
* **Content validation** sanitizes all input data
* **CSP compliance** with no inline scripts or event handlers
* **Error isolation** prevents crashes from malformed data
* **Token URL warnings** for temporary GitHub URLs

### Performance Optimizations

* **Smart caching** reduces redundant network requests
* **Incremental updates** only fetch when needed
* **Rule deduplication** optimizes memory usage
* **Background processing** doesn’t block UI interactions
* **Timeout handling** prevents hanging network requests
* **Rule merging** combines multiple blocklists efficiently

### GitHub Integration

* **Automatic URL conversion** from blob to raw URLs
* **Multiple fallback methods** (jsDelivr CDN, GitHub API)
* **Public repository validation**
* **Base64 decoding** for GitHub API responses
* **Error-specific messaging** for common GitHub issues

## Development

### Pre-Commit Validation

```shell
./install-hooks.sh
./validate-blocklist.sh
```

### Local Development

1. **Make changes** to source files
2. **Reload extension** in `chrome://extensions/` (or equivalent)
3. **Test functionality** with various scenarios
4. **Check browser console** for errors

### Creating Blocklists

1. **Use AWAGAM JSON format**
2. **Host on public HTTPS URL** for reliability
3. **Test validation** before sharing
4. **Consider jsDelivr CDN** for GitHub repositories

## Testing

### Built-in Functionality

Open `docs/test.html` in your browser to verify:

* Blocked links show “🛑” icons
* Click blocking with alert messages
* Dynamic link detection
* Popup toggle functionality

### Development Testing

1. **Load unpacked extension** with developer mode
2. **Check console** for error messages in background script
3. **Test various URL formats** and error conditions
4. **Verify caching behavior** and update mechanisms

## Troubleshooting

### Common Issues

#### “Blocklist error”

* Verify URL is accessible and uses HTTPS
* Check that repository is public (for GitHub URLs)
* Ensure JSON format matches AWAGAM specification
* Look at detailed error message in tooltip

#### “File not found (404)”

* URL may be incorrect or repository private
* Try alternative URL formats (raw, jsDelivr CDN)
* Verify file exists at the specified path

#### “Network error”

* Check Internet connection stability
* Verify URL uses HTTPS protocol
* Try again after temporary service outage
* Check browser network permissions

#### “Token URL warning”

* GitHub token URLs expire quickly
* Use public repository URLs instead
* Consider jsDelivr CDN for reliability

### Error Messages

The extension provides specific error diagnostics:

* **404:** File not found, check URL and permissions
* **403:** Access forbidden, repository may be private
* **Network error:** Connection or DNS problem
* **Invalid JSON:** Syntax error in blocklist file
* **Validation failed:** AWAGAM format specification issue

## Known and Open Issues

* The design is not consistent yet
* HTML and CSS code are not consistent yet
* The test blocklist could be extended and improved

## Contributing

1. **Submit issues** for bugs or feature requests
2. **Test blocklists** and share feedback
3. **Create sample blocklists** for community use
4. **Improve documentation** and examples
5. **Follow security best practices** in contributions

## Links

* [**Homepage**](https://codeberg.org/j9t/awagam)
* [**Sample blocklists**](https://github.com/j9t/awagam-sample-blocklists)
* [**Issue reporting**](https://codeberg.org/j9t/awagam/issues)