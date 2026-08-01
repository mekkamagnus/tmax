# (error ...) format interpolation + --stop single-print + literal-~ removal

## #72: (error "val=%d msg=%s" 42 "hi") → "val=42 msg=hi"
## #69: bin/tmax --stop prints "Daemon stopped" once; cleans stale files when no daemon answers
## #74: loadInitFile literal-~ fallback removed (dead code; no fs expands ~)
