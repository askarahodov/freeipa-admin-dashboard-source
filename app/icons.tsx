type IconProps = {
  size?: number;
  className?: string;
  strokeWidth?: number;
};

const baseProps = (size: number, strokeWidth: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className,
  "aria-hidden": true,
});

export function IconOverview({ size = 20, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

export function IconAutomation({ size = 20, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M12 2v3" />
      <path d="M12 19v3" />
      <path d="M4.2 4.2l2.1 2.1" />
      <path d="M17.7 17.7l2.1 2.1" />
      <path d="M2 12h3" />
      <path d="M19 12h3" />
      <path d="M4.2 19.8l2.1-2.1" />
      <path d="M17.7 6.3l2.1-2.1" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 10v2l1.5 1.5" />
    </svg>
  );
}

export function IconUsers({ size = 20, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 4.5a3 3 0 0 1 0 5.7" />
      <path d="M19 19c0-2.5-1.5-4.7-3.7-5.7" />
    </svg>
  );
}

export function IconGroups({ size = 20, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <circle cx="8" cy="9" r="2.7" />
      <circle cx="16" cy="9" r="2.7" />
      <circle cx="12" cy="6" r="2.2" />
      <path d="M2.5 20c0-2.7 2.2-5 5-5s5 2.3 5 5" />
      <path d="M11.5 20c0-2.7 2.2-5 5-5s5 2.3 5 5" />
    </svg>
  );
}

export function IconOperations({ size = 20, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function IconApprovals({ size = 20, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M4 12l5 5L20 6" />
      <path d="M3 19h18" />
    </svg>
  );
}

export function IconAudit({ size = 20, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <rect x="4" y="3" width="14" height="18" rx="2" />
      <path d="M8 8h6M8 12h6M8 16h4" />
      <path d="M19 7l3 3v9a2 2 0 0 1-2 2h-1" />
    </svg>
  );
}

export function IconSettings({ size = 20, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function IconSearch({ size = 18, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

export function IconBell({ size = 20, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9z" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function IconUser({ size = 20, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

export function IconGroup({ size = 20, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <circle cx="8" cy="9" r="2.7" />
      <circle cx="16" cy="9" r="2.7" />
      <circle cx="12" cy="6" r="2.2" />
      <path d="M2.5 20c0-2.7 2.2-5 5-5s5 2.3 5 5" />
      <path d="M11.5 20c0-2.7 2.2-5 5-5s5 2.3 5 5" />
    </svg>
  );
}

export function IconConnection({ size = 24, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M8 4H6a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-2" />
      <path d="M8 12h8" />
    </svg>
  );
}

export function IconPulse({ size = 24, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M3 12h4l3-9 4 18 3-9h4" />
    </svg>
  );
}

export function IconCheck({ size = 16, className, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

export function IconClose({ size = 16, className, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function IconWarning({ size = 18, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function IconPlay({ size = 16, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M6 4l14 8-14 8z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconStop({ size = 16, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconRefresh({ size = 16, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

export function IconPlus({ size = 16, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconArrowRight({ size = 14, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

export function IconShield({ size = 20, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function IconWorkflow({ size = 20, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="15" y="3" width="6" height="6" rx="1.5" />
      <rect x="9" y="15" width="6" height="6" rx="1.5" />
      <path d="M6 9v3a3 3 0 0 0 3 3M18 9v3a3 3 0 0 1-3 3" />
    </svg>
  );
}

export function IconEvent({ size = 18, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
    </svg>
  );
}

export function IconDatabase({ size = 18, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <ellipse cx="12" cy="5" rx="8" ry="2.5" />
      <path d="M4 5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5" />
      <path d="M4 11v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" />
    </svg>
  );
}

export function IconBackup({ size = 18, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M3 7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" />
      <path d="M9 12l3 3 5-5" />
      <path d="M12 5v10" />
    </svg>
  );
}

export function IconServer({ size = 18, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <rect x="3" y="3" width="18" height="7" rx="1.5" />
      <rect x="3" y="14" width="18" height="7" rx="1.5" />
      <circle cx="7" cy="6.5" r="0.6" fill="currentColor" />
      <circle cx="7" cy="17.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function IconSecurity({ size = 18, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function IconNetwork({ size = 18, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <circle cx="12" cy="12" r="3" />
      <circle cx="4" cy="5" r="2" />
      <circle cx="20" cy="5" r="2" />
      <circle cx="4" cy="19" r="2" />
      <circle cx="20" cy="19" r="2" />
      <path d="M6 6.5L9.5 10M18 6.5L14.5 10M6 17.5L9.5 14M18 17.5L14.5 14" />
    </svg>
  );
}

export function IconStorage({ size = 18, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M3 7l9-4 9 4-9 4z" />
      <path d="M3 12l9 4 9-4" />
      <path d="M3 17l9 4 9-4" />
    </svg>
  );
}

export function IconDeploy({ size = 18, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M12 3v14" />
      <path d="M5 10l7-7 7 7" />
      <path d="M5 21h14" />
    </svg>
  );
}

export function IconReport({ size = 18, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M4 4h16v16H4z" />
      <path d="M8 16v-3M12 16v-7M16 16v-5" />
    </svg>
  );
}

export function IconActivity({ size = 18, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M3 12h4l3-9 4 18 3-9h4" />
    </svg>
  );
}

export function IconTrend({ size = 18, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M3 17l6-6 4 4 8-9" />
      <path d="M14 6h7v7" />
    </svg>
  );
}

export function IconMore({ size = 18, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <circle cx="5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="19" cy="12" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function IconEdit({ size = 16, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M4 20h4l10-10-4-4L4 16z" />
      <path d="M14 6l4 4" />
    </svg>
  );
}

export function IconDelete({ size = 16, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14" />
    </svg>
  );
}

export function IconSave({ size = 16, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M5 3h11l4 4v14H5z" />
      <path d="M9 3v6h7V3" />
      <path d="M9 13h6v8H9z" />
    </svg>
  );
}

export function IconKey({ size = 18, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <circle cx="8" cy="14" r="4" />
      <path d="M11 12l9-9" />
      <path d="M16 7l3 3" />
      <path d="M19 4l3 3" />
    </svg>
  );
}

export function IconLdap({ size = 20, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <ellipse cx="12" cy="6" rx="8" ry="2.5" />
      <path d="M4 6v5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V6" />
      <path d="M4 11v5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-5" />
      <path d="M9 14l-2 6M15 14l2 6" />
    </svg>
  );
}

export function IconBlock({ size = 20, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M4 4h16v16H4z" />
      <path d="M4 8h16M4 12h16M4 16h16" />
    </svg>
  );
}

export function IconRepeat({ size = 20, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M4 12h10a2 2 0 0 1 2 2v6" />
      <path d="M20 12h-10a2 2 0 0 0-2-2v-6" />
      <path d="M12 4v10M8 4v10" />
    </svg>
  );
}

export function IconTimer({ size = 20, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}
