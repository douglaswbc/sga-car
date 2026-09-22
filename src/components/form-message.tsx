type Props = {
  tone: "error" | "notice";
  children: React.ReactNode;
};

export function FormMessage({ tone, children }: Readonly<Props>) {
  if (!children) return null;

  return (
    <p className={`form-message form-message--${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}
