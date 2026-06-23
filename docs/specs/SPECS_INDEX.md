# Specs Index

All specification and documentation files are numbered for easy reference.

## Complete List (25 Specs)

### Core Specifications (001-009)
- **SPEC-001** - Update/Delete Notes
- **SPEC-002** - Spec Prompt Template
- **SPEC-003** - PRD (Product Requirements Document)
- **SPEC-004** - T-Lisp Core Bindings Migration
- **SPEC-005** - T-Lisp Centric Keybindings
- **SPEC-006** - Implementation Spec: Save Functionality
- **SPEC-007** - Design: Save Functionality
- **SPEC-008** - Implementation Spec: Save Improved
- **SPEC-009** - Migrate UI to Deno Ink

### Chores and Tasks (010-029)
- **SPEC-010** - PRD (Additional/Updated Version)
- **SPEC-011** - Chore: Terminal UI Event Loop
- **SPEC-012** - Chore: Fix TypeScript Errors
- **SPEC-013** - Chore: Keybinding Migration Phase 1
- **SPEC-014** - Chore: Keybinding Phase 2
- **SPEC-015** - Chore: UI Test Suite Tmux Session
- **SPEC-016** - TypeScript Error Fixes Summary
- **SPEC-024** - Chore: UI Test Harness Refactoring
- **SPEC-025** - Chore: Init File System Refactoring
- **SPEC-026** - Chore: Investigate and Fix Pre-existing Test Failures
- **SPEC-029** - Chore: Remove All Deno Tests

### Terminal UI Implementation (017-021)
- **SPEC-017** - Terminal UI Complete
- **SPEC-018** - Terminal UI Implementation Status
- **SPEC-019** - Test Window Management Fix
- **SPEC-020** - UI Test Status
- **SPEC-021** - Terminal UI Final Status

### ADW Pipeline & Testing (030-061)
- **SPEC-048** - Generic E2E ADW Runner (YAML-driven, daemon-based)
- **SPEC-060** - adw tmux launcher — run pipelines in detached tmux windows
- **SPEC-061** - tmax-use — Control Library + Visual E2E Test Runner ([visual walkthrough](./SPEC-061-tmax-use.html))
- **SPEC-062** - adw Pipeline Observability — Live Console Visibility (RFC-020 §C + §B)
- **SPEC-063** - adw-test pipeline stage + remove Python UI harness
- **SPEC-064** - /adw-plan — planning-only adw skill (plan → spec-review → revised spec; resume with /adw-implement --resume <id> or /adw-implement docs/specs/SPEC-###.md)
- **SPEC-066** - adw-watchdog — two-layer stall detection and auto-resume

## Summary

- **Total Specs:** 31
- **Date:** 2026-06-21
- **Status:** All files properly numbered and organized

## Quick Reference

To find a spec by topic:
- **T-Lisp:** SPEC-004, SPEC-005
- **Save Functionality:** SPEC-006, SPEC-007, SPEC-008
- **UI Implementation:** SPEC-009, SPEC-017, SPEC-018, SPEC-021
- **Testing:** SPEC-015, SPEC-019, SPEC-020, SPEC-024, SPEC-026, SPEC-048, SPEC-061, SPEC-063, SPEC-066
- **TypeScript:** SPEC-012, SPEC-016
- **Keybindings:** SPEC-013, SPEC-014
- **Chores:** SPEC-011, SPEC-012, SPEC-024, SPEC-025, SPEC-026, SPEC-029
- **Test Refactoring:** SPEC-024
- **Configuration:** SPEC-025
- **ADW Pipeline:** SPEC-048, SPEC-060, SPEC-061, SPEC-062, SPEC-063, SPEC-064, SPEC-066
- **E2E Testing:** SPEC-048, SPEC-061

## Related ADRs

- **ADR 056** - Init File System Refactoring (Implementation of SPEC-025)
