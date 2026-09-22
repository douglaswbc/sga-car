export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="content">
      <div className="skeleton skeleton--title" />
      <section className="metrics">
        {[0, 1, 2, 3].map((item) => <div className="skeleton skeleton--card" key={item} />)}
      </section>
      <div className="skeleton skeleton--panel" />
    </div>
  );
}
