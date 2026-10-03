export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="stack">
      <div className="skeleton" style={{ height: 28, width: 260 }} />
      <div className="skeleton" style={{ height: 170 }} />
      <div className="grid grid-2"><div className="skeleton" style={{ height: 220 }} /><div className="skeleton" style={{ height: 220 }} /></div>
    </div>
  );
}
