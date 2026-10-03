export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="stack">
      <div className="skeleton" style={{ height: 28, width: 240 }} />
      <div className="grid grid-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 96 }} />)}</div>
      <div className="skeleton" style={{ height: 320 }} />
    </div>
  );
}
