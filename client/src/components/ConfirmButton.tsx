import { useEffect, useState, type ReactNode } from 'react';

interface Props {
  onConfirm: () => void;
  children: ReactNode;
  /** Shown after the first click; a second click within a few seconds confirms. */
  confirmLabel?: string;
  className?: string;
  armedClassName?: string;
  title?: string;
  disabled?: boolean;
}

/**
 * Two-step inline confirmation for frequent list removals, where a modal
 * dialog per click would be tiresome but a stray click should not delete.
 */
export default function ConfirmButton({ onConfirm, children, confirmLabel = '确认移除', className = '', armedClassName = 'text-accent font-medium', title, disabled }: Props) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <button
      type="button"
      title={armed ? '再次点击确认' : title}
      aria-label={armed ? `${confirmLabel}：再次点击确认` : title}
      disabled={disabled}
      onBlur={() => setArmed(false)}
      onClick={event => {
        event.stopPropagation();
        if (!armed) { setArmed(true); return; }
        setArmed(false);
        onConfirm();
      }}
      className={`${className} ${armed ? armedClassName : ''}`}
    >{armed ? confirmLabel : children}</button>
  );
}
