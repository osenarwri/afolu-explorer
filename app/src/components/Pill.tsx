"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function Pill({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="pill"
      data-active={active ? "true" : "false"}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function PillGroup({ children }: { children: ReactNode }) {
  return <div className="pill-group">{children}</div>;
}

// Custom dropdown (not a native <select>) so the open menu uses the platform's
// purple/teal palette and font instead of the OS default white/black chrome.
export interface PillOption {
  value: string;
  label: string;
  // Render as an uppercase category header (still selectable).
  strong?: boolean;
  // Render indented beneath a preceding header.
  indent?: boolean;
}

export function PillSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: PillOption[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value)?.label ?? value;

  const toggle = () => {
    if (!open && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      // Open upward if the pill sits in the lower half of the viewport.
      setOpenUp(rect.bottom > window.innerHeight / 2);
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="pill"
        data-active="false"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          style={{
            opacity: 0.7,
            display: "inline-block",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 150ms ease",
          }}
        >
          ▼
        </span>
        <span style={{ fontSize: "0.72rem", letterSpacing: "0.06em" }}>
          {label}
        </span>
        <span style={{ color: "var(--color-teal)", fontWeight: 600 }}>
          {current}
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          className="no-scrollbar"
          style={{
            position: "absolute",
            left: 0,
            [openUp ? "bottom" : "top"]: "calc(100% + 6px)",
            minWidth: "100%",
            maxHeight: 320,
            overflowY: "auto",
            background: "var(--color-purple-deep)",
            border: "1.5px solid var(--color-teal)",
            borderRadius: 10,
            padding: 4,
            zIndex: 1000,
            boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
          }}
        >
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  whiteSpace: "nowrap",
                  padding: "6px 12px",
                  paddingLeft: o.indent ? 28 : 12,
                  borderRadius: 6,
                  border: "none",
                  background: selected
                    ? "var(--color-teal)"
                    : "transparent",
                  color: selected
                    ? "var(--color-purple-deep)"
                    : "var(--color-text)",
                  fontWeight: selected || o.strong ? 600 : 400,
                  textTransform: o.strong ? "uppercase" : "none",
                  fontSize: o.strong ? "0.72rem" : "0.78rem",
                  letterSpacing: o.strong ? "0.06em" : "0.02em",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  if (!selected)
                    e.currentTarget.style.background =
                      "rgba(63, 217, 180, 0.16)";
                }}
                onMouseLeave={(e) => {
                  if (!selected)
                    e.currentTarget.style.background = "transparent";
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
