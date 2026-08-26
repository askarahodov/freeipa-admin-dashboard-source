"use client";

export default function Brand() {
  return (
    <div className="brand">
      <BrandMark />
      <div>
        <strong>Admin Dashboard Softrust</strong>
        <small>FreeIPA · XYOps</small>
      </div>
    </div>
  );
}

function BrandMark() {
  return (
    <svg
      className="brand-mark"
      xmlns="http://www.w3.org/2000/svg"
      width="42"
      height="42"
      viewBox="0 0 42 42"
      fill="none"
      aria-label="FreeIPA · XYOps"
      role="img"
    >
      <defs>
        <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7656e8" />
          <stop offset="100%" stopColor="#18a999" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="36" height="36" rx="10" fill="url(#brandGrad)" />
      <path
        d="M14 21l5 5 9-10"
        stroke="#fff"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}