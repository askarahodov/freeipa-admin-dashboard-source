# Form/dialog pattern implementation plan

Issue #96 / Epic #92

1. Define source-level tests before production components.
2. Add FormField, FormSection and FormErrorSummary.
3. Add controlled Dialog with keyboard focus management and return-focus semantics.
4. Add DialogFooter with separated danger slot and right-aligned ordinary actions.
5. Add token-based CSS module with calm, compact styling.
6. Export primitives through `app/ui/index.ts`.
7. Verify no domain/API/RBAC/destructive-confirmation coupling exists.
8. Open a draft PR against current `main` and let repository CI/Auth E2E provide full build/browser evidence.
9. Do not overwrite `app/page.tsx`; migrate reference entity forms later only through targeted safe edits.
