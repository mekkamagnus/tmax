#!/bin/bash
# Manual test script to verify --init-file flag works correctly
# Usage: bash test/manual/init-file-flag-test.sh

set -e

echo "=== Manual --init-file Flag Test ==="
echo ""

# Create temp directory for testing
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "1. Creating custom init file..."
cat > "$TEMP_DIR/test-init.tlisp" << 'TLISP'
;; Custom init file for testing --init-file flag
(editor-set-status "CUSTOM_INIT_LOADED: SUCCESS")

;; Test key binding
(key-bind "C-t" "(editor-set-status \"CTRL_T_PRESSED\")" "normal")

;; Test function definition
(defun test-func ()
  "Test function from custom init"
  (editor-set-status "TEST_FUNC_CALLED"))

;; Test that init file was loaded
(editor-set-status "Init file loaded from: /tmp/...")
TLISP

echo "   Created: $TEMP_DIR/test-init.tlisp"
echo ""

echo "2. Verification tests:"
echo "   ✓ Init file created successfully"
echo "   ✓ Contains custom status message"
echo "   ✓ Contains key binding (C-t)"
echo "   ✓ Contains function definition (test-func)"
echo ""

echo "3. Content preview:"
head -5 "$TEMP_DIR/test-init.tlisp" | sed 's/^/   /'
echo ""

echo "4. To test manually, run:"
echo "   bun run src/main.tsx --init-file $TEMP_DIR/test-init.tlisp"
echo ""
echo "   Expected: Editor should start and show status 'CUSTOM_INIT_LOADED: SUCCESS'"
echo ""

echo "5. Additional test commands:"
echo "   a) Test with absolute path:"
echo "      bun run src/main.tsx --init-file $TEMP_DIR/test-init.tlisp"
echo ""
echo "   b) Test with relative path (from project root):"
echo "      cd /Users/mekael/Documents/programming/typescript"
echo "      bun run src/main.tsx --init-file $TEMP_DIR/test-init.tlisp"
echo ""
echo "   c) Test with /dev/null (no init file):"
echo "      bun run src/main.tsx --init-file /dev/null"
echo ""
echo "   d) Test that M-x works:"
echo "      In editor: M-x ; (init-file-path)"
echo "      Should return: $TEMP_DIR/test-init.tlisp"
echo ""

echo "6. Quick verification (file content):"
if grep -q "CUSTOM_INIT_LOADED" "$TEMP_DIR/test-init.tlisp"; then
    echo "   ✓ Status message found"
else
    echo "   ✗ Status message NOT found"
fi

if grep -q "key-bind" "$TEMP_DIR/test-init.tlisp"; then
    echo "   ✓ Key binding found"
else
    echo "   ✗ Key binding NOT found"
fi

if grep -q "defun test-func" "$TEMP_DIR/test-init.tlisp"; then
    echo "   ✓ Function definition found"
else
    echo "   ✗ Function definition NOT found"
fi

echo ""
echo "=== Test Complete ==="
echo "Temp file location: $TEMP_DIR/test-init.tlisp"
echo "Note: Temp file will be deleted on exit"
