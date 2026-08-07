export interface FieldRequirementState {
  required: boolean;
  optional: boolean;
}

export function resolveFieldRequirement(
  wrapperRequired = false,
  controlRequired = false,
  optional = false,
): FieldRequirementState {
  const required = wrapperRequired || controlRequired;
  return { required, optional: !required && optional };
}
