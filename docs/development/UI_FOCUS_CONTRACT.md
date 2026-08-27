# UI focus contract

Keyboard-reachable interactive controls must expose a visible focus indicator with a minimum 2px outline. The shared rule lives in `app/focus-ring.css` and is loaded from the root layout.

This contract is covered by `e2e/specs/ui-quality.spec.mjs`.
