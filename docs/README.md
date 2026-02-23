# AWAGAM Documentation

This folder contains testing tools, samples, and additional documentation for the AWAGAM browser extension.

## Testing Tools

### test.html

Test page to test against [test blocklist](https://codeberg.org/j9t/awagam/raw/branch/main/docs/test.json).

### test-blocklists.html

Comprehensive testing interface for blocklist functionality:

* Tests GitHub URL access patterns
* Validates AWAGAM JSON format
* Tests security validation
* Tests various hosting services

## Sample Files

### test.json

Complete example of AWAGAM JSON format showing:

* Multiple groups (advertising, social-tracking, example-sites)
* All field types (domains, urls, tlds)
* Proper structure and formatting

## Usage

### For Development

1. **Load test files** in browser with extension enabled
2. **Run comprehensive tests** with test-blocklists.html
3. **Use sample blocklists** for development and testing

### For Users

1. **Reference sample format** when creating custom blocklists
2. **Use test URLs** to verify extension functionality
3. **Follow hosting guidelines** in sample documentation

## File Organization

```
docs/
├── README.md                           # This file
├── test.html                           # Extension test page
├── test.json                           # Complete format example
├── test.png                            # Test image
├── test-2.png                          # Test image 2
├── test-blocklists.html                # Blocklists test page
├── test-url-matching.html              # URL matching test page
```

## Notes

* **Test files are for development only** and not part of the extension package
* **Sample files demonstrate proper format** for blocklists
* **Documentation provides troubleshooting guidance** for common issues
* **All examples follow security best practices** (HTTPS only, public repos)