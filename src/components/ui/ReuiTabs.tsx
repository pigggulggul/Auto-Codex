import { useRef } from "react";

// Adapted from ReUI's c-tabs-1 composition (MIT), with native controls and
// project CSS in place of Radix and Tailwind.
// https://github.com/keenthemes/reui/blob/main/registry-reui/bases/radix/components/tabs/c-tabs-1.tsx
export function ReuiTabs<T extends string>({ label, panelId, value, onChange, items }: {
  label: string;
  panelId: string;
  value: T;
  onChange: (value: T) => void;
  items: readonly { value: T; label: string }[];
}) {
  const list = useRef<HTMLDivElement>(null);
  return <div className="reui-tabs" role="tablist" aria-label={label} ref={list} onKeyDown={event => {
    const index = items.findIndex(item => item.value === value);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    onChange(items[next].value);
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }}>
    {items.map(item => <button key={item.value} id={`${panelId}-${item.value}`} type="button" role="tab" aria-controls={panelId} aria-selected={value === item.value} tabIndex={value === item.value ? 0 : -1} className={value === item.value ? "active" : ""} onClick={() => onChange(item.value)}>{item.label}</button>)}
  </div>;
}
