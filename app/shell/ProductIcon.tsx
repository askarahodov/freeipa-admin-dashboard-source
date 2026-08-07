import type { SVGProps } from "react";
import type { ProductNavIconName } from "./navigation";

export interface ProductIconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: ProductNavIconName;
}

function IconPath({ name }: { name: ProductNavIconName }) {
  switch (name) {
    case "dashboard":
      return <><rect x="2.5" y="2.5" width="6" height="6" rx="1" /><rect x="11.5" y="2.5" width="6" height="4" rx="1" /><rect x="2.5" y="11.5" width="6" height="6" rx="1" /><rect x="11.5" y="9.5" width="6" height="8" rx="1" /></>;
    case "users":
      return <><circle cx="7" cy="6.5" r="2.5" /><path d="M2.8 16.5c.5-3 2-4.5 4.2-4.5s3.7 1.5 4.2 4.5" /><path d="M12.5 8.5c1.8.1 3 1.2 3.4 3" /><path d="M13 4.2a2.2 2.2 0 0 1 0 4.3" /></>;
    case "groups":
      return <><circle cx="6" cy="7" r="2.2" /><circle cx="14" cy="7" r="2.2" /><path d="M1.8 16c.5-2.8 1.9-4.2 4.2-4.2 1.6 0 2.8.7 3.5 2" /><path d="M10.5 13.8c.7-1.3 1.9-2 3.5-2 2.3 0 3.7 1.4 4.2 4.2" /></>;
    case "workflow":
      return <><rect x="2.5" y="3" width="5" height="4" rx="1" /><rect x="12.5" y="13" width="5" height="4" rx="1" /><path d="M7.5 5h3a3 3 0 0 1 3 3v5" /><path d="m11.5 11 2 2 2-2" /></>;
    case "activity":
      return <path d="M2 10h3l2-5 3.2 10 2.3-7 1.8 2H18" />;
    case "approval":
      return <><path d="M10 2.4 16 5v4.8c0 3.7-2.2 6.1-6 7.8-3.8-1.7-6-4.1-6-7.8V5l6-2.6Z" /><path d="m7.2 10 1.8 1.8 3.8-4" /></>;
    case "access":
      return <><path d="M10 2.4 16 5v4.8c0 3.7-2.2 6.1-6 7.8-3.8-1.7-6-4.1-6-7.8V5l6-2.6Z" /><circle cx="10" cy="8.5" r="1.5" /><path d="M10 10v3" /></>;
    case "sessions":
      return <><rect x="2.5" y="3" width="15" height="11" rx="1.5" /><path d="M7 17h6M10 14v3" /></>;
    case "audit":
      return <><path d="M5 3h10v14H5z" /><path d="M7.5 7h5M7.5 10h5M7.5 13h3" /></>;
    case "diagnostics":
      return <><circle cx="10" cy="10" r="7" /><path d="M3 10h3l1.5-3.5 3 7 2-4 1 1H17" /></>;
    case "settings":
      return <><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" /></>;
  }
}

export function ProductIcon({ name, width = 20, height = 20, ...props }: ProductIconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      width={width}
      height={height}
      {...props}
    >
      <IconPath name={name} />
    </svg>
  );
}
