# Form and dialog pattern design

Issue: #96  
Epic: #92

## Goal

Create one calm, accessible visual and behavioral grammar for ordinary entity create/edit forms and non-confirmation dialogs in Admin Dashboard Softrust.

This layer is presentation and interaction infrastructure only. It must not own API requests, RBAC decisions, FreeIPA/XYOps mutations, approvals or destructive confirmation semantics.

## Safety boundary

`app/PortalInteractionLayer.tsx` remains the single destructive-confirmation contract. It owns dangerous intent interception, reason collection, delete phrase protection and replay of confirmed clicks.

The shared Dialog introduced here MUST NOT:

- implement destructive confirmation;
- emulate `window.confirm`/`window.prompt`;
- replay mutations;
- interpret button labels as domain actions;
- contain FreeIPA/XYOps/RBAC knowledge.

## Components

### FormField

A field wrapper with:

- visible label;
- required/optional semantics;
- help text below the control;
- field error below the control;
- automatic `aria-describedby` and `aria-invalid` association for a single form control.

### FormSection

Groups related fields under a restrained section title and optional description. Intended labels include Basic, Membership and Advanced when domain content warrants them.

### FormErrorSummary

Form-level error summary using `role="alert"`, with links back to invalid controls where IDs are available.

### Dialog

Controlled ordinary dialog with:

- `role="dialog"` and `aria-modal="true"`;
- labelled title and optional description;
- Escape closes when permitted;
- Tab/Shift+Tab focus trap;
- initial focus inside the dialog;
- return focus to the element that had focus before opening;
- backdrop click close only when permitted;
- small/medium/large width variants;
- no domain/mutation logic.

### DialogFooter

One stable action hierarchy:

- optional danger/tertiary slot visually separated on the left;
- cancel/secondary and primary actions grouped on the right;
- pending state is expressed by disabling the submit button at the caller level rather than inventing request state inside the component.

## Visual language

- consumes #93 semantic tokens;
- border-first white surfaces;
- 8px maximum dialog radius;
- overlay shadow only on the dialog surface;
- no gradients, glow or hover lift;
- compact 14px form copy;
- errors are semantic red, not decorative badges;
- help text remains muted and secondary.

## Integration order

1. shared primitives and source contracts;
2. Create/Edit FreeIPA User;
3. Create Group;
4. Membership action dialog.

The first PR may stop after step 1 if safe targeted edits to the monolithic `app/page.tsx` are unavailable during parallel work. It must not replace that file wholesale.

## Accessibility acceptance

- every field error is associated with its control;
- dialog has accessible name;
- Escape semantics are explicit;
- keyboard focus cannot escape an open dialog via Tab;
- focus returns to the opener after close;
- required/optional status is visible and programmatically coherent.
