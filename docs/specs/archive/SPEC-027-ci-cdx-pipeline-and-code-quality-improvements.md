# Chore: CI/CD Pipeline and Code Quality Improvements

## Chore Description
This chore implements industry-standard CI/CD pipeline and code quality tooling for the tmax project. Currently, the project lacks automated testing infrastructure, code quality gates, security auditing, and release automation. This implementation will bring the project to production-ready standards with GitHub Actions workflows, linting, formatting, security scanning, and automated releases.

## Relevant Files
Use these files to resolve the chore:

### Existing Files (Modified)
- `package.json` - Add new scripts for linting, formatting, type checking, and coverage
- `.gitignore` - Add CI/CD artifacts and tool-generated files
- `README.md` - Add badges and CI/CD status section

### New Files

#### CI/CD Infrastructure
- `.github/workflows/ci.yml` - Main CI pipeline for testing, linting, type checking
- `.github/workflows/code-quality.yml` - Code coverage and quality reporting
- `.github/workflows/security.yml` - Security vulnerability scanning
- `.github/workflows/release.yml` - Automated release workflow
- `.github/dependabot.yml` - Automated dependency updates

#### Code Quality Configuration
- `.eslintrc.json` - ESLint configuration for TypeScript/React
- `.prettierrc.json` - Prettier formatting configuration
- `.prettierignore` - Files to exclude from Prettier
- `.editorconfig` - Editor configuration for consistent formatting
- `.github/CODEOWNERS` - Code ownership rules for PRs

#### Security and Licensing
- `LICENSE` - MIT License file (currently missing)
- `.github/SECURITY.md` - Security policy and vulnerability reporting
- `CODE_OF_CONDUCT.md` - Community code of conduct

#### Development Tooling
- `.husky/pre-commit` - Git hook for pre-commit validation
- `lint-staged.config.js` - Lint-staged configuration for staged files
- `.github/ISSUE_TEMPLATE/bug_report.md` - Bug report template
- `.github/ISSUE_TEMPLATE/feature_request.md` - Feature request template
- `.github/PULL_REQUEST_TEMPLATE.md` - PR template

#### Documentation
- `docs/CONTRIBUTING.md` - Update with new CI/CD requirements
- `.github/FUNDING.yml` - GitHub Sponsors configuration

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add Missing License File
- Create `LICENSE` file with MIT License text
- Reference this license in `package.json` if not already present
- Ensure the license year is current (2025-2026)

### 2. Create ESLint Configuration
- Create `.eslintrc.json` with TypeScript and React presets
- Configure rules to align with project's functional programming patterns
- Enable `@typescript-eslint/no-explicit-any`, `@typescript-eslint/explicit-function-return-type`
- Add React-specific rules for ink components
- Configure to ignore test files appropriately

### 3. Create Prettier Configuration
- Create `.prettiertrc.json` with formatting rules
- Set `trailingComma: "es5"`, `semi: true`, `singleQuote: true`
- Create `.prettierignore` excluding `node_modules`, `dist`, `*.lock`

### 4. Create EditorConfig
- Create `.editorconfig` with consistent settings
- Configure indent style/size for TypeScript, T-Lisp, Markdown
- Set end-of-line to LF (Unix style)

### 5. Update package.json Scripts
- Add `"lint"`: `eslint src/ test/ --ext .ts,.tsx`
- Add `"lint:fix"`: `eslint src/ test/ --ext .ts,.tsx --fix`
- Add `"format"`: `prettier --check "src/**/*.ts" "src/**/*.tsx" "test/**/*.ts"`
- Add `"format:fix"`: `prettier --write "src/**/*.ts" "src/**/*.tsx" "test/**/*.ts"`
- Add `"typecheck"`: `tsc --noEmit`
- Add `"test:coverage"`: `bun test --coverage`
- Add `"validate"`: `bun run typecheck && bun run lint && bun test`
- Add devDependencies for ESLint, Prettier, typescript-eslint

### 6. Create Main CI Workflow
- Create `.github/workflows/ci.yml`
- Trigger on push to main, pull requests to main
- Run on `ubuntu-latest` with Bun action setup
- Steps:
  1. Checkout code
  2. Setup Bun (use `setup-bun` action or manual install)
  3. Install dependencies (`bun install`)
  4. Type check (`bun run typecheck`)
  5. Lint (`bun run lint`)
  6. Run tests (`bun test`)
  7. Upload coverage as artifact

### 7. Create Code Quality Workflow
- Create `.github/workflows/code-quality.yml`
- Run on every pull request
- Steps:
  1. Checkout code
  2. Setup Bun
  3. Install dependencies
  4. Run tests with coverage (`bun test --coverage`)
  5. Comment coverage on PR using coverage action
  6. Check for coverage threshold (minimum 70%)

### 8. Create Security Workflow
- Create `.github/workflows/security.yml`
- Run weekly on Sundays at 00:00 UTC
- Steps:
  1. Checkout code
  2. Run `bun audit` or equivalent security check
  3. Fail on high/critical vulnerabilities
  4. Create issue if vulnerabilities found

### 9. Create Dependabot Configuration
- Create `.github/dependabot.yml`
- Configure for npm/bun dependencies
- Check daily at 6:00 AM UTC
- Group production and dev dependencies separately
- Set label `dependencies` for created PRs

### 10. Create Release Workflow
- Create `.github/workflows/release.yml`
- Trigger on version tag push (e.g., `v*`)
- Steps:
  1. Checkout code
  2. Setup Bun
  3. Install dependencies
  4. Run full validation (`bun run validate`)
  5. Build project
  6. Create GitHub release
  7. Upload artifacts (if any)

### 11. Configure Git Hooks with Husky
- Add `husky` and `lint-staged` to devDependencies
- Create `.husky/pre-commit` hook running `lint-staged`
- Configure `lint-staged.config.js` to run ESLint and Prettier on staged files
- Add `prepare` script to package.json for automatic Husky setup

### 12. Create Security Policy
- Create `.github/SECURITY.md`
- Document vulnerability reporting process
- Specify supported versions
- Provide security email/contact

### 13. Create Issue and PR Templates
- Create `.github/ISSUE_TEMPLATE/bug_report.md`
  - Environment details (OS, Bun version)
  - Steps to reproduce
  - Expected vs actual behavior
- Create `.github/ISSUE_TEMPLATE/feature_request.md`
  - Feature description
  - Use case motivation
  - Proposed implementation ideas
- Create `.github/PULL_REQUEST_TEMPLATE.md`
  - Description of changes
  - Related issues
  - Testing checklist
  - Breaking changes note

### 14. Create Code of Conduct
- Create `CODE_OF_CONDUCT.md`
- Use Contributor Covenant v2.1
- Adapt for open source community standards

### 15. Create CODEOWNERS File
- Create `.github/CODEOWNERS`
- Set default code owner
- Specify owners for critical paths (src/core, src/tlisp)

### 16. Update .gitignore
- Add `.eslintcache`
- Add `.husky/_/`
- Add coverage directories
- Add `.env.local`

### 17. Update README.md
- Add section at top with CI/CD badges
- Add section on code quality standards
- Update Contributing section with new requirements
- Add SECURITY.md link

### 18. Update Contributing Documentation
- Update `docs/contributing/CONTRIBUTING.md`
- Add pre-commit requirements
- Document CI/CD pipeline
- Add code style guidelines referencing ESLint/Prettier
- Update PR submission checklist

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

```bash
# 1. Verify all new configuration files are valid
cat .eslintrc.json && echo "✅ ESLint config exists"
cat .prettierrc.json && echo "✅ Prettier config exists"
cat .editorconfig && echo "✅ EditorConfig exists"
cat LICENSE && echo "✅ LICENSE file exists"

# 2. Verify ESLint runs without errors
bun run lint

# 3. Verify Prettier check passes
bun run format

# 4. Verify TypeScript compilation check passes
bun run typecheck

# 5. Verify all tests still pass
bun test

# 6. Verify pre-commit hook is executable
test -x .husky/pre-commit && echo "✅ Pre-commit hook is executable"

# 7. Verify workflow YAML syntax (if yamllint available)
# yamllint .github/workflows/*.yml .github/workflows/*.yaml

# 8. Verify package.json scripts are complete
bun run lint && echo "✅ Lint script works"
bun run typecheck && echo "✅ Typecheck script works"
bun run validate && echo "✅ Validate script works"

# 9. Check all required files exist
ls -la .github/workflows/ci.yml && echo "✅ CI workflow exists"
ls -la .github/workflows/code-quality.yml && echo "✅ Code quality workflow exists"
ls -la .github/workflows/security.yml && echo "✅ Security workflow exists"
ls -la .github/workflows/release.yml && echo "✅ Release workflow exists"
ls -la .github/dependabot.yml && echo "✅ Dependabot config exists"
ls -la .github/SECURITY.md && echo "✅ Security policy exists"
ls -la CODE_OF_CONDUCT.md && echo "✅ Code of conduct exists"
```

## Notes

### Dependencies to Add
```json
{
  "devDependencies": {
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^8.57.0",
    "eslint-plugin-react": "^7.34.0",
    "eslint-plugin-react-hooks": "^4.6.0",
    "prettier": "^3.2.0",
    "husky": "^9.0.0",
    "lint-staged": "^15.2.0"
  }
}
```

### ESLint Configuration Notes
- Use `@typescript-eslint/recommended` for TypeScript rules
- Use `plugin:react/recommended` for React/ink components
- Configure `react/react-in-jsx-scope: off` since using JSX with React 18+
- Set `parserOptions.project` for tsconfig integration

### Prettier Configuration Notes
- Align with existing code style (arrow functions, trailing commas)
- Use 2 spaces for indentation
- Set print width to 100 characters

### CI/CD Strategy
- Use GitHub Actions (free for public repositories)
- Cache `node_modules` between runs for faster builds
- Fail fast on type checking and linting before running tests
- Upload coverage reports as artifacts for review

### Security Notes
- Enable Dependabot security alerts
- Configure for automated PR creation for dependency updates
- Set up weekly security audits

### Release Automation Notes
- Use semantic versioning for releases
- Create Git tag for each release (e.g., `v0.2.1`)
- Generate CHANGELOG automatically from commit messages (future enhancement)

### Future Enhancements (Out of Scope)
- Automated changelog generation
- Code coverage reporting to Codecov/Coveralls
- Performance benchmarking in CI
- Multi-platform testing (macOS, Windows)
- Docker container for CI builds
- Integration test suite with real terminal
