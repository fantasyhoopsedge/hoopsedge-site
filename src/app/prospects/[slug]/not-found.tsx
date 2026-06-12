export default function NotFound() {
  return (
    <main className="min-h-screen bg-[#0A0A0A] flex items-center justify-center text-white">
      <div className="text-center">
        <h1 className="font-bold text-4xl mb-4" style={{ fontFamily: 'Oswald' }}>
          Prospect Not Found
        </h1>
        <p className="text-white/60 mb-6">This prospect is not on the FHE 2026 board.</p>
        <a href="/2026-dynasty-rookie-board" className="text-[#2563EB] underline">
          ← Back to Rookie Board
        </a>
      </div>
    </main>
  );
}
