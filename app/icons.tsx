import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function IconBase({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return <IconBase {...props}><path d="M6 6l12 12M18 6L6 18" /></IconBase>;
}

export function IconRefresh(props: IconProps) {
  return <IconBase {...props}><path d="M20 11a8 8 0 10-2.34 5.66" /><path d="M20 4v7h-7" /></IconBase>;
}

export function IconWarning(props: IconProps) {
  return <IconBase {...props}><path d="M12 3L2.8 19h18.4L12 3z" /><path d="M12 9v4" /><path d="M12 17h.01" /></IconBase>;
}

export function IconTimer(props: IconProps) {
  return <IconBase {...props}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2" /><path d="M9 2h6" /></IconBase>;
}

export function IconBlock(props: IconProps) {
  return <IconBase {...props}><circle cx="12" cy="12" r="9" /><path d="M6 6l12 12" /></IconBase>;
}

export function IconRepeat(props: IconProps) {
  return <IconBase {...props}><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 013-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 01-3 3H3" /></IconBase>;
}
