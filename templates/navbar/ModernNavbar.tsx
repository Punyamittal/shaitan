export function ModernNavbar() {
  return (
    <header className="border-b border-zinc-200 bg-white px-6 py-4">
      <nav className="mx-auto flex max-w-6xl items-center justify-between">
        <div className="text-lg font-semibold">Local AI IDE</div>
        <div className="flex gap-6 text-sm text-zinc-700">
          <a href="#">Home</a>
          <a href="#">Templates</a>
          <a href="#">Docs</a>
        </div>
      </nav>
    </header>
  );
}
