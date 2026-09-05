export default function ArchiveLoading() {
  return (
    <main
      id="main-content"
      className="mist-page relative min-h-screen overflow-x-hidden px-6 py-24 sm:px-10"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold tracking-[0.16em] text-[#7b6d97]">DREAM FILES</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#3f3753] sm:text-4xl">
          正在打开梦境档案…
        </h1>
        <div className="mt-10 grid gap-4 sm:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((item) => (
            <div key={item} className="mist-card h-28 animate-pulse rounded-2xl" />
          ))}
        </div>
        <div className="mist-card mt-8 h-[28rem] animate-pulse rounded-2xl" aria-hidden="true" />
      </div>
    </main>
  );
}
