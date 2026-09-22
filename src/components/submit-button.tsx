"use client";

import { useFormStatus } from "react-dom";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  pendingLabel?: string;
};

export function SubmitButton({ children, pendingLabel, className = "button", disabled, ...rest }: Readonly<Props>) {
  const { pending } = useFormStatus();

  return (
    <button
      {...rest}
      aria-busy={pending}
      className={className}
      disabled={pending || disabled}
      type="submit"
    >
      {pending ? <span aria-hidden="true" className="spinner" /> : null}
      {pending ? (pendingLabel ?? "Enviando…") : children}
    </button>
  );
}
